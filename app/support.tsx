import { useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';

// ── Support channels ─────────────────────────────────────────────────────────
// All MVP-friendly (no backend required):
//   - tel: link opens the dialer with the number pre-filled
//   - wa.me opens WhatsApp (installed) or web fallback with the pre-filled chat
//   - mailto: opens the default mail client
//
// Live chat: deliberately using WhatsApp here instead of Intercom/Crisp/etc.
// For a Turkish audience WhatsApp is the dominant chat channel (>95% of users
// on iOS have it installed) and it's zero backend + zero cost. If we later
// want in-app chat, swap to Crisp (free tier, has RN SDK).
const PHONES = ['+90 538 540 21 61', '+90 553 024 26 25'];
const WHATSAPP_NUMBER = '905385402161'; // first phone as primary WA handler
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
    q: 'ekipman bozuk/eksik. ne yapmam lazım?',
    a: 'hemen whatsapp veya telefon ile bize ulaş. kendini mağdur hissetmemen için hızlıca çözüyoruz.',
  },
  {
    q: 'rezervasyonumu iptal edebilir miyim?',
    a: 'evet. rezervasyonlar sekmesinden istediğin zaman iptal edebilirsin. kilit süresi dolmadan iptal etsen ücret yok.',
  },
];

function ChannelButton({
  icon,
  label,
  sub,
  color,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  sub: string;
  color: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 16,
        paddingHorizontal: 18,
        borderRadius: 18,
        backgroundColor: theme.fg + '06',
        borderWidth: 1,
        borderColor: theme.fg + '10',
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          backgroundColor: color + '22',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Feather name={icon} size={20} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: theme.fg,
            fontSize: 15,
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Text>
        <Text
          style={{
            fontFamily: 'JetBrainsMono_400Regular',
            color: theme.fg + '88',
            fontSize: 12,
            marginTop: 3,
          }}
          numberOfLines={1}
        >
          {sub}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={theme.fg + '66'} />
    </Pressable>
  );
}

function FaqRow({ item, isOpen, onToggle }: { item: Faq; isOpen: boolean; onToggle: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => ({
        paddingVertical: 14,
        paddingHorizontal: 2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text
          style={{
            flex: 1,
            fontFamily: 'Unbounded_700Bold',
            color: theme.fg,
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
          color={theme.fg + '99'}
        />
      </View>
      {isOpen ? (
        <Text
          style={{
            fontFamily: 'Inter_400Regular',
            color: theme.fg + 'b3',
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
  const theme = useTheme();
  const router = useRouter();
  const { t } = useT();
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
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderBottomWidth: 1,
          borderBottomColor: theme.fg + '10',
        }}
      >
        <Pressable onPress={onBack} hitSlop={14} style={{ padding: 4, marginLeft: -4 }}>
          <Feather name="chevron-left" size={26} color={theme.fg} />
        </Pressable>
        <Text
          style={{
            fontFamily: 'Unbounded_700Bold',
            color: theme.fg,
            fontSize: 18,
            letterSpacing: 0.2,
          }}
        >
          Destek
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 40,
        }}
      >
        {/* Hero */}
        <View style={{ paddingVertical: 24 }}>
          <Text
            style={{
              fontFamily: 'Unbounded_800ExtraBold',
              color: theme.fg,
              fontSize: 30,
              lineHeight: 36,
            }}
          >
            nasıl yardımcı{'\n'}olabiliriz?
          </Text>
          <Text
            style={{
              fontFamily: 'Inter_400Regular',
              color: theme.fg + '99',
              fontSize: 14,
              marginTop: 8,
              lineHeight: 20,
            }}
          >
            hızlı yanıt için whatsapp, acil durumlar için telefon.
          </Text>
        </View>

        {/* Channel buttons */}
        <View style={{ gap: 10 }}>
          <ChannelButton
            icon="message-circle"
            label="whatsapp"
            sub="7/24 hızlı yanıt"
            color={'#25D366'}
            onPress={whatsApp}
          />
          {PHONES.map((p) => (
            <ChannelButton
              key={p}
              icon="phone"
              label="telefon"
              sub={p}
              color={palette.coral}
              onPress={() => call(p)}
            />
          ))}
          <ChannelButton
            icon="mail"
            label="e-posta"
            sub={SUPPORT_EMAIL}
            color={palette.mauve}
            onPress={email}
          />
        </View>

        {/* FAQ */}
        <Text
          style={{
            fontFamily: 'Inter_500Medium',
            color: theme.fg + '99',
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            marginTop: 36,
            marginBottom: 6,
          }}
        >
          sık sorulanlar
        </Text>
        <View
          style={{
            borderRadius: 18,
            backgroundColor: theme.fg + '06',
            paddingHorizontal: 16,
            paddingVertical: 4,
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
                <View style={{ height: 1, backgroundColor: theme.fg + '10' }} />
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
