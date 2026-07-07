import { useEffect, useState } from 'react';
import { Image, Text, View, TextInput, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';
import { Button } from '@/components/ui';
import { useGuardedPress } from '@/hooks/useGuardedPress';
import { useDevStore } from '@/stores/devStore';
import { useSessionStore } from '@/stores/sessionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { isDemoUsername } from '@/constants/review';

export default function Welcome() {
  const { t } = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const titleLines = t('onb.welcome.title').split('\n');

  const onStart = useGuardedPress(async () => {
    await hx.press();
    router.push('/(onboarding)/intro-map');
  });

  // App Store review "Demo Login": entering the configured demo username drops
  // straight into the app in Demo Mode (mock hardware, no phone/OTP/Supabase).
  const setDemoSession = useDevStore((s) => s.setDemoSession);
  const setDemoMode = useDevStore((s) => s.setDemoMode);
  const setNameOverride = useSettingsStore((s) => s.setNameOverride);
  const setUsernameOverride = useSettingsStore((s) => s.setUsernameOverride);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoUser, setDemoUser] = useState('');
  const [demoErr, setDemoErr] = useState(false);

  const onDemoLogin = async () => {
    if (!isDemoUsername(demoUser)) {
      setDemoErr(true);
      await hx.no();
      return;
    }
    await hx.press();
    const name = demoUser.trim().replace(/^@/, '');
    // Wipe any stale persisted session from prior testing so the reviewer starts
    // clean — otherwise canStart() sees a lingering `active` and OYNA dead-ends
    // with the generic error before the mock unlock even runs.
    useSessionStore.getState().endSession();
    setUsernameOverride(name);
    setNameOverride(name);
    setDemoMode(true);
    setDemoSession(true);
    router.replace('/(tabs)/map');
  };

  // Logo entrance: springy zoom-in + tilt settle, then a slow idle bob.
  const logoScale = useSharedValue(0.6);
  const logoOpacity = useSharedValue(0);
  const logoRotate = useSharedValue(-8);
  const logoBob = useSharedValue(0);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    logoScale.value = withSpring(1, { damping: 10, stiffness: 140, mass: 0.9 });
    logoRotate.value = withSequence(
      withTiming(4, { duration: 280, easing: Easing.out(Easing.cubic) }),
      withSpring(0, { damping: 8, stiffness: 160 }),
    );
    logoBob.value = withDelay(
      900,
      withRepeat(
        withSequence(
          withTiming(-6, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 1400, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
  }, [logoBob, logoOpacity, logoRotate, logoScale]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [
      { translateY: logoBob.value },
      { scale: logoScale.value },
      { rotate: `${logoRotate.value}deg` },
    ],
  }));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.bg }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: insets.top + 32,
        paddingBottom: insets.bottom + 16,
      }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
    >
      <View style={{ alignItems: 'center', marginTop: 8, marginBottom: 24 }}>
        <Animated.View
          style={[
            {
              width: 132,
              height: 132,
              borderRadius: 28,
              overflow: 'hidden',
              backgroundColor: palette.surface,
              borderWidth: 1,
              borderColor: palette.border,
              shadowColor: palette.deep,
              shadowOffset: { width: 0, height: 14 },
              shadowOpacity: 0.4,
              shadowRadius: 22,
              elevation: 14,
            },
            logoStyle,
          ]}
        >
          <Image
            source={require('@/assets/images/icon.png')}
            style={{ width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        </Animated.View>
      </View>

      <RiseIn delay={0}>
        <View style={{ marginTop: 12 }}>
          {titleLines.map((line, i) => (
            <Text
              key={i}
              style={{
                fontFamily: 'Unbounded_800ExtraBold',
                color: palette.ink,
                fontSize: 56,
                lineHeight: 66,
              }}
            >
              {line}
            </Text>
          ))}
        </View>
      </RiseIn>

      <RiseIn delay={120}>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink,
            fontSize: 17,
            lineHeight: 24,
            marginTop: 22,
            opacity: 0.85,
          }}
        >
          {t('onb.welcome.sub')}
        </Text>
      </RiseIn>

      <View style={{ flex: 1 }} />

      <RiseIn delay={220}>
        <Button label={t('onb.welcome.cta')} onPress={onStart} full />
      </RiseIn>

      {/* App Store review Demo Login — subtle link that reveals a username field. */}
      <RiseIn delay={280}>
        {demoOpen ? (
          <View style={{ marginTop: 14 }}>
            <TextInput
              value={demoUser}
              onChangeText={(v) => {
                setDemoUser(v);
                setDemoErr(false);
              }}
              placeholder="demo kullanıcı adı"
              placeholderTextColor={palette.muted}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={onDemoLogin}
              style={{
                backgroundColor: palette.surface,
                borderWidth: 1,
                borderColor: demoErr ? palette.danger : palette.border,
                borderRadius: 14,
                paddingHorizontal: 16,
                height: 50,
                color: palette.fg,
                fontFamily: 'Inter_500Medium',
                fontSize: 15,
              }}
            />
            <View style={{ marginTop: 10 }}>
              <Button label="demo giriş" variant="ghost" onPress={onDemoLogin} full />
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setDemoOpen(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Demo Login"
            style={{ alignItems: 'center', paddingVertical: 12, marginTop: 4 }}
          >
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                fontSize: 13,
                color: palette.muted,
                textDecorationLine: 'underline',
              }}
            >
              Demo Login
            </Text>
          </Pressable>
        )}
      </RiseIn>
    </ScrollView>
  );
}
