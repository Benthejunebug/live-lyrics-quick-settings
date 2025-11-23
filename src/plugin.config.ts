/**
 * Plugin configuration.
 */
export default {
    /**
     * Custom element prefix, must be unique
     */
    ce_prefix: 'live-lyrics-quick-settings',
    identifier: 'com.antigravity.live-lyrics-quick-settings',
    name: 'Live Lyrics Quick Settings',
    description: 'Quickly adjust lyrics offset from the top bar.',
    version: '0.0.1',
    author: 'antigravity',
    repo: 'https://github.com/antigravity/live-lyrics-quick-settings',
    entry: {
        'plugin.js': {
            type: 'main',
        }
    }
}