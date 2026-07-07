import { Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeIn, SlideInDown } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';

import { palette } from '@/constants/theme';
import { hx } from '@/lib/haptics';
import { directionsOptions, type Destination } from '@/lib/directions';

type Props = { dest: Destination | null; visible: boolean; onClose: () => void };

/**
 * On-brand maps-app chooser (replaces the default Alert). A dark bottom sheet
 * with the destination name and one row per maps app.
 */
export function DirectionsSheet({ dest, visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const options = dest ? directionsOptions(dest) : [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(160)} style={{ flex: 1 }}>
        <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' }}>
          {/* Plain slide-up, no spring — a simple pull-up-from-bottom (was
              SlideInDown.springify() which overshot and "bounced crazily"). */}
          <Animated.View entering={SlideInDown.duration(240).easing(Easing.out(Easing.cubic))}>
            <Pressable
              onPress={() => {}}
              style={{
                backgroundColor: palette.surface,
                borderTopLeftRadius: 28,
                borderTopRightRadius: 28,
                borderTopWidth: 1,
                borderColor: palette.border,
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: insets.bottom + 16,
              }}
            >
              {/* grabber */}
              <View
                style={{
                  alignSelf: 'center',
                  width: 40,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: palette.border,
                  marginBottom: 16,
                }}
              />

              <Text
                style={{
                  fontFamily: 'Unbounded_800ExtraBold',
                  fontSize: 20,
                  textTransform: 'uppercase',
                  color: palette.fg,
                }}
              >
                yol tarifi
              </Text>
              {dest ? (
                <Text
                  style={{
                    fontFamily: 'Inter_400Regular',
                    fontSize: 13,
                    color: palette.muted,
                    marginTop: 4,
                    marginBottom: 16,
                  }}
                >
                  {dest.name}
                </Text>
              ) : null}

              {options.map((o) => (
                <Pressable
                  key={o.key}
                  onPress={async () => {
                    await hx.tap();
                    o.onPress();
                    onClose();
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    paddingVertical: 14,
                    paddingHorizontal: 14,
                    borderRadius: 16,
                    backgroundColor: palette.surfaceAlt,
                    borderWidth: 1,
                    borderColor: palette.border,
                    marginBottom: 10,
                  }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      backgroundColor: palette.volt,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Feather name="navigation" size={18} color={palette.voltInk} />
                  </View>
                  <Text
                    style={{
                      flex: 1,
                      fontFamily: 'Inter_600SemiBold',
                      fontSize: 16,
                      color: palette.fg,
                    }}
                  >
                    {o.label}
                  </Text>
                  <Feather name="chevron-right" size={20} color={palette.muted} />
                </Pressable>
              ))}

              <Pressable
                onPress={async () => {
                  await hx.tap();
                  onClose();
                }}
                style={{ alignItems: 'center', paddingVertical: 14, marginTop: 2 }}
              >
                <Text
                  style={{
                    fontFamily: 'Inter_600SemiBold',
                    fontSize: 15,
                    color: palette.muted,
                  }}
                >
                  iptal
                </Text>
              </Pressable>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}
