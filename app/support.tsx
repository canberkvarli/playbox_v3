import { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';

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
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderRadius: 16,
        backgroundColor: palette.paper,
        borderWidth: 1,
        borderColor: palette.ink + '14',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: accent + '1f',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name={icon} size={20} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 15,
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            color: palette.ink + 'aa',
            fontSize: 12,
            marginTop: 4,
          }}
          numberOfLines={1}
        >
          {sub}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={palette.ink + '66'} />
    </Pressable>
  );
}

function FaqRow({
  item,
  isOpen,
  onToggle,
}: {
  item: Faq;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => ({
        paddingVertical: 14,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text
          style={{
            flex: 1,
            fontFamily: 'Unbounded_700Bold',
            color: palette.ink,
            fontSize: 14,
            letterSpacing: 0.1,
            lineHeight: 20,
          }}
        >
          {item.q}
        </Text>
        <Feather
          name={isOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={palette.ink + '99'}
        />
      </View>
      {isOpen ? (
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: palette.ink + 'cc',
            fontSize: 13,
            lineHeight: 19,
            marginTop: 8,
          }}
        >
          {item.a}
        </Text>
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

        <SectionLabel>iletişim</SectionLabel>

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

        <SectionLabel>sık sorulanlar</SectionLabel>

        <View
          style={{
            borderRadius: 16,
            backgroundColor: palette.ink + '08',
            paddingHorizontal: 16,
          }}
        >
          {FAQ_ITEMS.map((item, i) => (
            <View key={item.q}>
              <FaqRow
                item={item}
                isOpen={openIdx === i}
                onToggle={() => setOpenIdx(openIdx === i ? null : i)}
              />
              {i < FAQ_ITEMS.length - 1 ? (
                <View style={{ height: 1, backgroundColor: palette.ink + '10' }} />
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: 'Unbounded_800ExtraBold',
        color: palette.ink,
        fontSize: 13,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        marginTop: 32,
        marginBottom: 14,
      }}
    >
      {children}
    </Text>
  );
}
