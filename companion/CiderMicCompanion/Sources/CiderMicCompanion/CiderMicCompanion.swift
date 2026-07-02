import AppKit
import AVFoundation
import CoreAudio
import Foundation
import Network
import OSLog

private struct CompanionHello: Encodable {
  let type: String
  let sampleRate: Double
  let channels: Int
  let format: String
  let frameSize: Int
}

private let logSubsystem = Bundle.main.bundleIdentifier ?? "CiderMicCompanion"

private final class WebSocketServer {
  private let queue = DispatchQueue(label: "CiderMicCompanion.WebSocket")
  private var listener: NWListener?
  private var connection: NWConnection?
  private let logger = Logger(subsystem: logSubsystem, category: "WebSocket")

  var onClientConnected: ((Bool) -> Void)?
  var onStopRequested: (() -> Void)?

  func start(host: String = "127.0.0.1", port: UInt16 = 17890) {
    guard listener == nil else { return }
    let parameters = NWParameters.tcp
    let wsOptions = NWProtocolWebSocket.Options()
    wsOptions.autoReplyPing = true
    parameters.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)

    guard let nwPort = NWEndpoint.Port(rawValue: port) else {
      logger.error("Invalid port: \(port)")
      return
    }

    do {
      listener = try NWListener(using: parameters, on: nwPort)
    } catch {
      logger.error("Failed to start listener: \(String(describing: error), privacy: .public)")
      return
    }

    listener?.newConnectionHandler = { [weak self] connection in
      self?.setupConnection(connection)
    }

    listener?.stateUpdateHandler = { state in
      self.logger.info("Listener state: \(String(describing: state), privacy: .public)")
    }

    listener?.start(queue: queue)
    logger.info("WebSocket server listening on ws://\(host, privacy: .public):\(port)")
  }

  func stop() {
    connection?.cancel()
    connection = nil
    listener?.cancel()
    listener = nil
  }

  func sendHello(sampleRate: Double, channels: Int, frameSize: Int) {
    let hello = CompanionHello(
      type: "hello",
      sampleRate: sampleRate,
      channels: channels,
      format: "pcm16",
      frameSize: frameSize
    )
    guard let payload = try? JSONEncoder().encode(hello) else { return }
    logger.info("Sending hello sampleRate=\(sampleRate, format: .fixed(precision: 0)) channels=\(channels) frameSize=\(frameSize)")
    sendText(payload)
  }

  func sendBinary(_ data: Data) {
    guard let connection else { return }
    let metadata = NWProtocolWebSocket.Metadata(opcode: .binary)
    let context = NWConnection.ContentContext(identifier: "binary", metadata: [metadata])
    connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { [logger] error in
      if let error {
        logger.error("Binary send failed: \(String(describing: error), privacy: .public)")
      }
    })
  }

  private func setupConnection(_ connection: NWConnection) {
    self.connection?.cancel()
    self.connection = connection

    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        self?.logger.info("Client connected.")
        self?.onClientConnected?(true)
        self?.receive(on: connection)
      case .failed(let error):
        self?.logger.error("Connection failed: \(String(describing: error), privacy: .public)")
        self?.connection = nil
        self?.onClientConnected?(false)
      case .cancelled:
        self?.logger.info("Connection cancelled.")
        self?.connection = nil
        self?.onClientConnected?(false)
      default:
        break
      }
    }

    connection.start(queue: queue)
  }

  private func receive(on connection: NWConnection) {
    connection.receiveMessage { [weak self] data, context, _, error in
      if let error {
        self?.logger.error("Receive error: \(String(describing: error), privacy: .public)")
        return
      }

      if let context,
         let metadata = context.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata,
         metadata.opcode == .text,
         let data,
         let text = String(data: data, encoding: .utf8) {
        self?.handleText(text)
      }

      self?.receive(on: connection)
    }
  }

  private func handleText(_ text: String) {
    guard let data = text.data(using: .utf8),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = json["type"] as? String else {
      return
    }
    if type == "stop" {
      onStopRequested?()
    }
  }

  private func sendText(_ data: Data) {
    guard let connection else { return }
    let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
    let context = NWConnection.ContentContext(identifier: "text", metadata: [metadata])
    connection.send(content: data, contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
  }
}

private final class AudioCapture {
  private let engine = AVAudioEngine()
  private let frameSize: AVAudioFrameCount = 1024
  private let logger = Logger(subsystem: logSubsystem, category: "AudioCapture")
  private(set) var inputSampleRate: Double = 44100
  private(set) var inputChannelCount: Int = 1
  private(set) var isRunning = false
  private var frameBatchCount = 0

  var onPCMFrame: ((Data) -> Void)?

  func refreshDeviceInfo() {
    let format = engine.inputNode.outputFormat(forBus: 0)
    inputSampleRate = format.sampleRate
    inputChannelCount = Int(format.channelCount)
  }

  func start() throws {
    guard !isRunning else { return }
    refreshDeviceInfo()
    logger.info("Starting capture sampleRate=\(self.inputSampleRate, format: .fixed(precision: 0)) channels=\(self.inputChannelCount)")

    if #available(macOS 14.0, *) {
      let app = AVAudioApplication.shared
      logger.info("Record permission state: \(String(describing: app.recordPermission), privacy: .public)")
      logger.info("Input muted before start: \(app.isInputMuted)")
      if app.isInputMuted {
        do {
          try app.setInputMuted(false)
          logger.info("Cleared application input mute before capture start.")
        } catch {
          logger.error("Failed to clear application input mute: \(String(describing: error), privacy: .public)")
        }
      }
    }

    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    logger.info("Input node output format sampleRate=\(format.sampleRate, format: .fixed(precision: 0)) channels=\(format.channelCount)")

    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: frameSize, format: format) { [weak self] buffer, _ in
      self?.handle(buffer: buffer)
    }

    engine.prepare()
    try engine.start()
    frameBatchCount = 0
    isRunning = true
    logger.info("AVAudioEngine started.")
  }

  func stop() {
    guard isRunning else { return }
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    isRunning = false
    logger.info("AVAudioEngine stopped.")
  }

  private func handle(buffer: AVAudioPCMBuffer) {
    guard let channelData = buffer.floatChannelData else { return }
    let frameLength = Int(buffer.frameLength)
    let channels = Int(buffer.format.channelCount)

    if frameLength == 0 { return }

    var pcm = [Int16](repeating: 0, count: frameLength)
    var peak: Float = 0
    var sumSq: Float = 0
    var nonZeroCount = 0
    for i in 0..<frameLength {
      var sum: Float = 0
      for ch in 0..<channels {
        sum += channelData[ch][i]
      }
      let mono = sum / Float(channels)
      if mono != 0 {
        nonZeroCount += 1
      }
      let abs = Swift.abs(mono)
      if abs > peak {
        peak = abs
      }
      sumSq += mono * mono
      let clipped = max(-1.0, min(1.0, mono))
      pcm[i] = Int16(clipped * 32767.0)
    }

    frameBatchCount += 1
    if frameBatchCount <= 5 || frameBatchCount % 50 == 0 || nonZeroCount == 0 {
      let rms = sqrt(sumSq / Float(max(frameLength, 1)))
      let nonZeroPct = (Double(nonZeroCount) / Double(frameLength)) * 100
      logger.info("Input frame \(self.frameBatchCount) len=\(frameLength) rms=\(rms, format: .fixed(precision: 5)) peak=\(peak, format: .fixed(precision: 5)) nonZero=\(nonZeroPct, format: .fixed(precision: 2))%")
    }

    let data = pcm.withUnsafeBytes { Data($0) }
    onPCMFrame?(data)
  }
}

private final class MenuController {
  private let audioCapture: AudioCapture
  private let server: WebSocketServer
  private let statusItem: NSStatusItem

  private let startItem = NSMenuItem(title: "Start Streaming", action: nil, keyEquivalent: "")
  private let stopItem = NSMenuItem(title: "Stop Streaming", action: nil, keyEquivalent: "")
  private let statusItemLabel = NSMenuItem(title: "Status: Initializing", action: nil, keyEquivalent: "")
  private let connectionItem = NSMenuItem(title: "Connection: Disconnected", action: nil, keyEquivalent: "")
  private let deviceItem = NSMenuItem(title: "Device: Unknown", action: nil, keyEquivalent: "")
  private let rateItem = NSMenuItem(title: "Sample Rate: Unknown", action: nil, keyEquivalent: "")

  private var micPermissionGranted = false

  init(audioCapture: AudioCapture, server: WebSocketServer) {
    self.audioCapture = audioCapture
    self.server = server
    self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    setupMenu()
  }

  private func setupMenu() {
    statusItem.button?.title = "Mic"
    let menu = NSMenu()

    startItem.target = self
    startItem.action = #selector(startStreaming)

    stopItem.target = self
    stopItem.action = #selector(stopStreaming)

    statusItemLabel.isEnabled = false
    connectionItem.isEnabled = false
    deviceItem.isEnabled = false
    rateItem.isEnabled = false

    menu.addItem(startItem)
    menu.addItem(stopItem)
    menu.addItem(NSMenuItem.separator())
    menu.addItem(statusItemLabel)
    menu.addItem(connectionItem)
    menu.addItem(deviceItem)
    menu.addItem(rateItem)

    statusItem.menu = menu
    updateMenuState()
  }

  func setMicPermission(granted: Bool) {
    micPermissionGranted = granted
    if granted {
      statusItemLabel.title = "Status: Ready"
    } else {
      statusItemLabel.title = "Status: Mic permission denied"
    }
    updateMenuState()
  }

  func updateConnectionState(connected: Bool) {
    connectionItem.title = connected ? "Connection: Connected" : "Connection: Disconnected"
  }

  func refreshDeviceInfo() {
    audioCapture.refreshDeviceInfo()
    deviceItem.title = "Device: \(defaultInputDeviceName())"
    rateItem.title = String(format: "Sample Rate: %.0f Hz", audioCapture.inputSampleRate)
  }

  @objc func startStreaming() {
    guard micPermissionGranted else {
      showPermissionAlert()
      return
    }
    do {
      try audioCapture.start()
      refreshDeviceInfo()
      statusItemLabel.title = "Status: Streaming"
      updateMenuState()
      server.sendHello(sampleRate: audioCapture.inputSampleRate, channels: 1, frameSize: 1024)
    } catch {
      statusItemLabel.title = "Status: Failed to start"
      updateMenuState()
      showErrorAlert(message: error.localizedDescription)
    }
  }

  @objc func stopStreaming() {
    audioCapture.stop()
    statusItemLabel.title = "Status: Stopped"
    updateMenuState()
  }

  private func updateMenuState() {
    startItem.isEnabled = micPermissionGranted && !audioCapture.isRunning
    stopItem.isEnabled = audioCapture.isRunning
  }

  private func showPermissionAlert() {
    let alert = NSAlert()
    alert.messageText = "Microphone access required"
    alert.informativeText = "Enable microphone access in System Settings > Privacy & Security > Microphone."
    alert.addButton(withTitle: "OK")
    alert.runModal()
  }

  private func showErrorAlert(message: String) {
    let alert = NSAlert()
    alert.messageText = "Failed to start streaming"
    alert.informativeText = message
    alert.addButton(withTitle: "OK")
    alert.runModal()
  }
}

private func defaultInputDeviceName() -> String {
  var deviceID = AudioObjectID(kAudioObjectSystemObject)
  var propertyAddress = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDefaultInputDevice,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var dataSize = UInt32(MemoryLayout<AudioObjectID>.size)
  let status = AudioObjectGetPropertyData(
    AudioObjectID(kAudioObjectSystemObject),
    &propertyAddress,
    0,
    nil,
    &dataSize,
    &deviceID
  )
  if status != noErr {
    return "Unknown"
  }

  propertyAddress.mSelector = kAudioObjectPropertyName
  var cfName: CFString? = nil
  var nameSize = UInt32(MemoryLayout<CFString?>.size)
  let getStatus: OSStatus = withUnsafeMutablePointer(to: &cfName) { ptr in
    ptr.withMemoryRebound(to: UnsafeMutableRawPointer?.self, capacity: 1) { rawPtr in
      // AudioObjectGetPropertyData expects an UnsafeMutableRawPointer for outData
      return AudioObjectGetPropertyData(
        deviceID,
        &propertyAddress,
        0,
        nil,
        &nameSize,
        rawPtr
      )
    }
  }
  if getStatus != noErr, cfName == nil {
    return "Unknown"
  }
  if let cfName {
    return cfName as String
  } else {
    return "Unknown"
  }
}

@main
final class CompanionApp: NSObject, NSApplicationDelegate {
  private let audioCapture = AudioCapture()
  private let server = WebSocketServer()
  private var menuController: MenuController?
  private let logger = Logger(subsystem: logSubsystem, category: "Permission")

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)

    let menuController = MenuController(audioCapture: audioCapture, server: server)
    self.menuController = menuController

    audioCapture.onPCMFrame = { [weak server] data in
      server?.sendBinary(data)
    }

    server.onClientConnected = { [weak menuController, weak audioCapture, weak server] connected in
      DispatchQueue.main.async {
        menuController?.updateConnectionState(connected: connected)
        if connected, let audioCapture, audioCapture.isRunning {
          menuController?.refreshDeviceInfo()
          server?.sendHello(sampleRate: audioCapture.inputSampleRate, channels: 1, frameSize: 1024)
        }
      }
    }

    server.onStopRequested = { [weak menuController] in
      DispatchQueue.main.async {
        menuController?.stopStreaming()
      }
    }

    requestMicPermission()
    server.start()
  }

  private func requestMicPermission() {
    if #available(macOS 14.0, *) {
      let permission = AVAudioApplication.shared.recordPermission
      logger.info("Initial AVAudioApplication recordPermission: \(String(describing: permission), privacy: .public)")
      AVAudioApplication.requestRecordPermission { [weak self] granted in
        DispatchQueue.main.async {
          self?.logger.info("AVAudioApplication record permission granted: \(granted)")
          self?.menuController?.setMicPermission(granted: granted)
          if granted {
            self?.menuController?.refreshDeviceInfo()
            self?.menuController?.startStreaming()
          }
        }
      }
      return
    }

    AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
      DispatchQueue.main.async {
        self?.logger.info("AVCaptureDevice audio permission granted: \(granted)")
        self?.menuController?.setMicPermission(granted: granted)
        if granted {
          self?.menuController?.refreshDeviceInfo()
          self?.menuController?.startStreaming()
        }
      }
    }
  }
}
