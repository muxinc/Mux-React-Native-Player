import * as React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { AccessibilityRole, StyleProp, ViewProps, ViewStyle } from 'react-native';

export type TVButtonState = { focused: boolean; pressed: boolean };

const NO_PARALLAX = { enabled: false };

export type TVButtonProps = {
  label: string;
  onPress: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** Not focusable or pressable, without the dimmed disabled look (e.g. behind an open panel). */
  inert?: boolean;
  selected?: boolean;
  /** Apple TV nudges the focused control as the remote is touched; false keeps it still. */
  parallax?: boolean;
  preferredFocus?: boolean;
  /** Content may depend on focus, e.g. icons that invert on a white focus fill. */
  children?: React.ReactNode | ((state: TVButtonState) => React.ReactNode);
  style?: StyleProp<ViewStyle> | ((state: TVButtonState) => StyleProp<ViewStyle>);
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  checked?: boolean;
  nextFocusUp?: ViewProps['nextFocusUp'];
  nextFocusDown?: ViewProps['nextFocusDown'];
  nextFocusLeft?: ViewProps['nextFocusLeft'];
  nextFocusRight?: ViewProps['nextFocusRight'];
};

export const TVButton = React.forwardRef<React.ElementRef<typeof Pressable>, TVButtonProps>(function TVButton(
  { label, onPress, onFocus, onBlur, disabled = false, inert = false, selected = false, parallax = true, preferredFocus = false, children, style,
    accessibilityHint, accessibilityRole = 'button', checked, nextFocusUp, nextFocusDown, nextFocusLeft, nextFocusRight }, ref,
) {
  const [focused, setFocused] = React.useState(false);
  const [preferredFocusConsumed, setPreferredFocusConsumed] = React.useState(false);
  const [focusTargetsReady, setFocusTargetsReady] = React.useState(false);
  React.useEffect(() => {
    if (!preferredFocus) setPreferredFocusConsumed(false);
  }, [preferredFocus]);
  return (
    <Pressable
      ref={ref}
      accessible
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected, checked }}
      disabled={disabled || inert}
      focusable={!disabled && !inert}
      tvParallaxProperties={parallax ? undefined : NO_PARALLAX}
      // tvOS reapplies preferred focus during layout; consume the request once
      // the control has focus so later layouts cannot steal it back.
      hasTVPreferredFocus={preferredFocus && !preferredFocusConsumed && !disabled && !inert}
      // Fabric resolves tvOS destination tags immediately when these props
      // change. Before attachment there is no root to search, and it never
      // retries unchanged tags. Install links after the native layout event.
      onLayout={() => setFocusTargetsReady(true)}
      nextFocusUp={focusTargetsReady ? nextFocusUp : undefined}
      nextFocusDown={focusTargetsReady ? nextFocusDown : undefined}
      nextFocusLeft={focusTargetsReady ? nextFocusLeft : undefined}
      nextFocusRight={focusTargetsReady ? nextFocusRight : undefined}
      onFocus={() => { setFocused(true); setPreferredFocusConsumed(true); onFocus?.(); }}
      onBlur={() => { setFocused(false); onBlur?.(); }}
      onPress={onPress}
      style={({ pressed }) => [
        typeof style === 'function' ? style({ focused, pressed }) : style,
        disabled && styles.disabled,
      ]}
    >
      {({ pressed }) => typeof children === 'function'
        ? children({ focused, pressed })
        : children ?? <Text style={[styles.label, focused && styles.focusedLabel]}>{label}</Text>}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  disabled: { opacity: 0.38 },
  label: { color: '#FFFFFF', fontSize: 24, fontWeight: '600' },
  focusedLabel: { color: '#242628' },
});
