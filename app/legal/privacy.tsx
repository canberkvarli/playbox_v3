import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';

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
          borderBottomColor: palette.ink + '14',
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
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginRight: 12 })}
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
        <Text
          style={{
            fontFamily: 'Unbounded_800ExtraBold',
            color: palette.ink,
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
            color: palette.ink,
            fontSize: 36,
            lineHeight: 40,
          }}
        >
          aydınlatma metni
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_600SemiBold',
            color: palette.ink,
            fontSize: 14,
            lineHeight: 20,
            marginTop: 10,
            opacity: 0.75,
          }}
        >
          son güncelleme: 27 nisan 2026 · sürüm 1.1
        </Text>

        {SECTIONS.map((s) => (
          <View key={s.heading} style={{ marginTop: 28 }}>
            <Text
              style={{
                fontFamily: 'Unbounded_700Bold',
                color: palette.ink,
                fontSize: 16,
                lineHeight: 22,
                letterSpacing: 0.2,
              }}
            >
              {s.heading}
            </Text>
            <Text
              style={{
                fontFamily: 'Inter_600SemiBold',
                color: palette.ink,
                fontSize: 15,
                lineHeight: 22,
                marginTop: 8,
                opacity: 0.85,
              }}
            >
              {s.body}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
