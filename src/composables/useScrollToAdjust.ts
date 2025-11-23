import { ref, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';

export interface ScrollToAdjustOptions {
    enabled: Ref<boolean>;
    modifierKey: Ref<'Alt' | 'Control' | 'Meta' | 'Shift'>;
    scrollSensitivity: Ref<number>;
    onOffsetChange: (delta: number) => void;
    onScrollStart?: () => void;
    onScrollEnd?: () => void;
}

export function useScrollToAdjust(options: ScrollToAdjustOptions) {
    const isModifierHeld = ref(false);
    let scrollEndTimeout: number | null = null;

    const handleKeyDown = (event: KeyboardEvent) => {
        if (!options.enabled.value) return;

        // Check if the pressed key matches the configured modifier
        const keyMap = {
            Alt: event.altKey,
            Control: event.ctrlKey,
            Meta: event.metaKey,
            Shift: event.shiftKey,
        };

        if (keyMap[options.modifierKey.value]) {
            isModifierHeld.value = true;
        }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
        if (!options.enabled.value) return;

        // Check if the released key was the configured modifier
        const keyMap = {
            Alt: !event.altKey,
            Control: !event.ctrlKey,
            Meta: !event.metaKey,
            Shift: !event.shiftKey,
        };

        if (keyMap[options.modifierKey.value]) {
            isModifierHeld.value = false;

            // Trigger scroll end after a short delay
            if (scrollEndTimeout) {
                clearTimeout(scrollEndTimeout);
            }
            scrollEndTimeout = setTimeout(() => {
                options.onScrollEnd?.();
            }, 100) as unknown as number;
        }
    };

    const handleWheel = (event: WheelEvent) => {
        if (!options.enabled.value || !isModifierHeld.value) return;

        // Prevent default scroll behavior when modifier is held
        event.preventDefault();
        event.stopPropagation();

        // Calculate offset delta
        // Scroll up (negative deltaY) = increase offset (lyrics appear later)
        // Scroll down (positive deltaY) = decrease offset (lyrics appear earlier)
        const delta = -Math.sign(event.deltaY) * options.scrollSensitivity.value;

        // Notify scroll start
        options.onScrollStart?.();

        // Update offset
        options.onOffsetChange(delta);

        // Reset scroll end timeout
        if (scrollEndTimeout) {
            clearTimeout(scrollEndTimeout);
        }
        scrollEndTimeout = setTimeout(() => {
            options.onScrollEnd?.();
        }, 1500) as unknown as number;
    };

    onMounted(() => {
        // Attach global event listeners
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);
        document.addEventListener('wheel', handleWheel, { passive: false });
    });

    onUnmounted(() => {
        // Clean up event listeners
        document.removeEventListener('keydown', handleKeyDown);
        document.removeEventListener('keyup', handleKeyUp);
        document.removeEventListener('wheel', handleWheel);

        if (scrollEndTimeout) {
            clearTimeout(scrollEndTimeout);
        }
    });

    return {
        isModifierHeld,
    };
}
