import { useEffect, useState } from 'react';
import {
  LayoutAnimation,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { RiseIn } from '@/components/RiseIn';

// Smooth height transition for the accordion on Android too.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const PHONES = ['+90 538 540 21 61', '+90 553 024 26 25'];
const WHATSAPP_NUMBER = '905385402161';
const SUPPORT_EMAIL = 'destek@playbox.app';

type Faq = { q: string; a: string };
const FAQ_ITEMS: Faq[] = [
  {
    q: 'kapı açılmıyor, ne yapmalıyım?',
    a: 'önce uygulamada seansın aktif olduğunu doğrula. yakındaysan "tekrar dene"ye bas. sorun devam ederse whatsapp ile bize yaz.',
  },
  {
    q: 'iade ettim ama seans bitmiyor?',
    a: 'ekipmanı kapattığından emin ol ve uygulamadan "seansı bitir" ile onayla. eğer ekipman yerindeyse ve kilit kapalıysa "evet, kapattım" tuşuna bas.',
  },
  {
    q: 'ücret nasıl hesaplanıyor?',
    a: 'dakika başı ücretlendirme. planladığın sürenin üstüne geçersen her ek dakika otomatik eklenir. kartın bittiğinde toplam tutar tek seferde tahsil edilir.',
  },
  {
    q: 'ekipman bozuk/eksik, ne yapmam lazım?',
    a: 'hemen whatsapp veya telefon ile bize ulaş. mağdur kalmaman için hızlıca çözüyoruz.',
  },
  {
    q: 'rezervasyonumu iptal edebilir miyim?',
    a: 'evet. rezervasyonlar sekmesinden istediğin zaman iptal edebilirsin. ilk 2 dakika içinde iptal ücretsizdir.',
  },
];

function ChannelButton({
  icon,
  label,
  sub,
  accent,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  sub: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} — ${sub}`}
      style={({ pressed }) => ({
        // Compact horizontal card: icon | text stack | chevron, all on one
        // centered row. Tight padding keeps the four channels reading as a
        // neat list of cards rather than tall floaty stacks.
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 11,
        paddingHorizontal: 13,
        borderRadius: 14,
        backgroundColor: accent + '0a',
        borderWidth: 1,
        borderColor: accent + '24',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          // Smaller badge keeps the channel tint but shrinks row height.
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: accent + '24',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name={icon} size={17} color={accent} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 13.5,
            letterSpacing: 0.2,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: palette.ink + '99',
            fontSize: 12,
          }}
          numberOfLines={1}
        >
          {sub}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={palette.ink + '59'} />
    </Pressable>
  );
}

function FaqCard({
  item,
  isOpen,
  onToggle,
}: {
  item: Faq;
  isOpen: boolean;
  onToggle: () => void;
}) {
  // Rotate the toggle glyph 45° so the "+" reads as an "×" when open.
  const rot = useSharedValue(isOpen ? 1 : 0);
  useEffect(() => {
    rot.value = withTiming(isOpen ? 1 : 0, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [isOpen, rot]);

  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rot.value * 45}deg` }],
  }));

  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: isOpen }}
      style={({ pressed }) => ({
        borderRadius: 18,
        backgroundColor: palette.paper,
        borderWidth: 1,
        // Open cards get a warm coral edge; closed cards stay quiet ink.
        borderColor: isOpen ? palette.coral + '4d' : palette.ink + '12',
        paddingHorizontal: 16,
        paddingVertical: 15,
        // Subtle lift so the cards float on the paper rather than blending in.
        shadowColor: palette.ink,
        shadowOpacity: isOpen ? 0.08 : 0.04,
        shadowRadius: isOpen ? 14 : 8,
        shadowOffset: { width: 0, height: isOpen ? 6 : 3 },
        elevation: isOpen ? 3 : 1,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text
          style={{
            flex: 1,
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 14,
            letterSpacing: 0.1,
            lineHeight: 21,
          }}
        >
          {item.q}
        </Text>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: isOpen ? palette.coral : palette.ink + '0d',
          }}
        >
          <Animated.View style={glyphStyle}>
            <Feather
              name="plus"
              size={16}
              color={isOpen ? palette.paper : palette.ink + '99'}
            />
          </Animated.View>
        </View>
      </View>

      {isOpen ? (
        <View
          style={{
            flexDirection: 'row',
            gap: 12,
            marginTop: 12,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: palette.ink + '0f',
          }}
        >
          {/* Coral accent rule keys the answer to the open state. */}
          <View
            style={{
              width: 3,
              borderRadius: 2,
              backgroundColor: palette.coral + '66',
            }}
          />
          <Text
            style={{
              flex: 1,
              fontFamily: 'Inter_400Regular',
              color: palette.ink + 'cc',
              fontSize: 13.5,
              lineHeight: 20,
            }}
          >
            {item.a}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function Support() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  useT();
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const call = async (phone: string) => {
    await hx.tap();
    Linking.openURL(`tel:${phone.replace(/\s/g, '')}`).catch(() => {});
  };

  const whatsApp = async () => {
    await hx.tap();
    const msg = encodeURIComponent('merhaba, playbox ile ilgili yardıma ihtiyacım var.');
    Linking.openURL(`https://wa.me/${WHATSAPP_NUMBER}?text=${msg}`).catch(() => {});
  };

  const email = async () => {
    await hx.tap();
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {});
  };

  const onBack = async () => {
    await hx.tap();
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {/* Header — round back-pill only, page title lives in the scroll
          content as a large H1. Same convention as payments.tsx and
          reservations.tsx so all three screens align visually. */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="geri"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: palette.ink + '0d',
              borderWidth: 1,
              borderColor: palette.ink + '14',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="arrow-left" size={20} color={palette.ink} />
          </View>
        </Pressable>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <RiseIn delay={0}>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: palette.ink,
              fontSize: 38,
              lineHeight: 42,
              marginTop: 16,
            }}
          >
            destek
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_600SemiBold',
              color: palette.ink,
              fontSize: 16,
              lineHeight: 22,
              marginTop: 8,
            }}
          >
            hızlı yanıt için whatsapp, acil durumlar için telefon.
          </Text>
        </RiseIn>

        <RiseIn delay={60}>
          <SectionLabel kicker="kanal seç">iletişim</SectionLabel>

          <View style={{ gap: 10 }}>
            <ChannelButton
              icon="message-circle"
              label="whatsapp"
              sub="7/24 hızlı yanıt"
              accent={'#25D366'}
              onPress={whatsApp}
            />
            {PHONES.map((p) => (
              <ChannelButton
                key={p}
                icon="phone"
                label="telefon"
                sub={p}
                accent={palette.coral}
                onPress={() => call(p)}
              />
            ))}
            <ChannelButton
              icon="mail"
              label="e-posta"
              sub={SUPPORT_EMAIL}
              accent={palette.mauve}
              onPress={email}
            />
          </View>
        </RiseIn>

        <RiseIn delay={140}>
          <SectionLabel kicker="merak edilenler">sık sorulanlar</SectionLabel>

          <View style={{ gap: 10 }}>
            {FAQ_ITEMS.map((item, i) => (
              <FaqCard
                key={item.q}
                item={item}
                isOpen={openIdx === i}
                onToggle={() => {
                  hx.tap();
                  LayoutAnimation.configureNext(
                    LayoutAnimation.create(
                      200,
                      LayoutAnimation.Types.easeInEaseOut,
                      LayoutAnimation.Properties.opacity
                    )
                  );
                  setOpenIdx(openIdx === i ? null : i);
                }}
              />
            ))}
          </View>
        </RiseIn>
      </ScrollView>
    </View>
  );
}

function SectionLabel({
  children,
  kicker,
}: {
  children: React.ReactNode;
  kicker?: string;
}) {
  return (
    <View style={{ marginTop: 34, marginBottom: 16 }}>
      {/* Coral tick + tiny mono kicker gives each section a quiet anchor
          so Contact and FAQ read as distinct zones, not one long stack. */}
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}
      >
        <View
          style={{
            width: 14,
            height: 3,
            borderRadius: 2,
            backgroundColor: palette.coral,
          }}
        />
        {kicker ? (
          <Text
            style={{
              fontFamily: 'JetBrainsMono_500Medium',
              color: palette.ink + '80',
              fontSize: 11,
              letterSpacing: 1,
              textTransform: 'uppercase',
            }}
          >
            {kicker}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          fontFamily: 'Unbounded_800ExtraBold',
          color: palette.ink,
          fontSize: 20,
          letterSpacing: 0.2,
        }}
      >
        {children}
      </Text>
    </View>
  );
}
