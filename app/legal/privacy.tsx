import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';
import { Surface } from '@/components/ui';

const SECTIONS: Array<{ heading: string; body: string }> = [
  {
    heading: '1. veri sahibi olarak senin hakların',
    body: 'kvkk 11. madde kapsamında işlenen verilerine erişme, düzeltme, silme ve veri aktarımına itiraz etme hakkına sahipsin. dilediğin zaman ayarlardan hesabını silerek tüm verilerini de silebilirsin.',
  },
  {
    heading: '2. işlenen veriler',
    body: 'telefon numaran (kimlik doğrulama), konumun (yakındaki istasyonları gösterme ve kapı açma), seans verilerin (süre, istasyon, spor), rezervasyon kayıtların (kapı, süre, sonuç), push tokenı (bildirim gönderebilmek için) ve kart bilgilerin (iyzico üzerinden tokenize edilmiş şekilde — biz kart numaranı görmeyiz).',
  },
  {
    heading: '3. rezervasyon ve teminat verileri',
    body: 'rezervasyon yaptığında kart üzerinde bloke koyma, vaktinde iptal etmediğinde tahsilat ve tekrarlayan ihlaller için geçici hesap kilidi uygularız. bu işlemleri yürütebilmek için rezervasyonların geçmişi (oluşturma, iptal, kullanma, süresi dolma) ve sonuçları en fazla 90 gün boyunca aktif kayıtta tutulur; sonra anonimleştirilir.',
  },
  {
    heading: '4. veri saklama süresi',
    body: 'aktif hesap sahibiysen verilerin platformda kalır. hesap silindiğinde tüm kişisel veriler 24 saat içinde sistemden kaldırılır; iyzico tarafındaki kayıtlı kartın da aynı sürede silinir. yasal zorunluluk gereği vergi/fatura kayıtları 10 yıl boyunca anonim olarak saklanabilir.',
  },
  {
    heading: '5. üçüncü taraflar',
    body: 'iyzico (ödeme), supabase (sunucu altyapısı), twilio verify (telefon doğrulama), apple/google (push bildirimleri) ile veri paylaşımı yapılır. her biri kvkk uyumlu çalışır ve kendi gizlilik politikalarına tabidir.',
  },
  {
    heading: '6. çerezler & analiz',
    body: 'uygulamanın hangi ekranlarının nasıl kullanıldığını anlamak için anonim kullanım verisi toplarız. kişisel kimliğine bağlı değildir.',
  },
  {
    heading: '7. iletişim',
    body: 'soruların için destek@playbox.app adresine yazabilirsin. kvkk başvuruları aynı adrese yapılabilir; 30 gün içinde yanıtlanır.',
  },
];

export default function Privacy() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 20,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: palette.border,
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={async () => {
            await hx.tap();
            router.back();
          }}
          hitSlop={14}
          accessibilityRole="button"
          accessibilityLabel="geri"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginRight: 20 })}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: palette.surfaceAlt,
              borderWidth: 1,
              borderColor: palette.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Feather name="arrow-left" size={20} color={palette.fg} />
          </View>
        </Pressable>
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.fg,
            fontSize: 14,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
          }}
        >
          gizlilik
        </Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 24,
          paddingBottom: insets.bottom + 40,
        }}
      >
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.fg,
            fontSize: 36,
            lineHeight: 42,
            textTransform: 'uppercase',
          }}
        >
          aydınlatma metni
        </Text>
        <Text
          style={{
            fontFamily: 'JetBrainsMono_500Medium',
            color: palette.muted,
            fontSize: 12,
            lineHeight: 18,
            letterSpacing: 0.4,
            marginTop: 10,
          }}
        >
          son güncelleme: 27 nisan 2026 · sürüm 1.1
        </Text>

        {SECTIONS.map((s) => (
          <Surface key={s.heading} tone="card" radius={20} padding={18} style={{ marginTop: 16 }}>
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.fg,
                fontSize: 16,
                lineHeight: 22,
                letterSpacing: 0.2,
                textTransform: 'uppercase',
              }}
            >
              {s.heading}
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_400Regular',
                color: palette.muted,
                fontSize: 15,
                lineHeight: 22,
                marginTop: 8,
              }}
            >
              {s.body}
            </Text>
          </Surface>
        ))}
      </ScrollView>
    </View>
  );
}
