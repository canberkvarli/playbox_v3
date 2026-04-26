import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';

const SECTIONS: Array<{ heading: string; body: string }> = [
  {
    heading: '1. hizmetin tanımı',
    body: 'playbox, kullanıcılarına şehirdeki spor istasyonlarından dakika bazlı ekipman kiralama hizmeti sağlar. kapı açıldığında süre başlar, ekipman istasyona iade edildiğinde sona erer.',
  },
  {
    heading: '2. ücretlendirme',
    body: 'her dakika için sabit bir ücret tahsil edilir (kdv dahil). seansı başlatmadan önce uygulamadan tahmini ücreti görebilirsin. ücret seans bitiminde kayıtlı kartından otomatik çekilir.',
  },
  {
    heading: '3. süre aşımı ve geç iade',
    body: 'planlanan süreyi aştığında her ek dakika normal ücret üzerinden saymaya devam eder. ekipman makul bir süre içinde iade edilmezse hesabın geçici olarak askıya alınabilir ve ek ceza ücreti uygulanabilir.',
  },
  {
    heading: '4. eksik veya hasarlı parça',
    body: 'kapıdan aldığın ekipman ile aynı parçaları, sağlam halde iade etmeyi taahhüt edersin. eksik parça veya kasıtlı hasar durumunda yenileme bedeli kart hesabına yansıtılır.',
  },
  {
    heading: '5. hesap güvenliği',
    body: 'hesabın senin sorumluluğundadır. telefonunu ya da uygulamayı başkalarıyla paylaşmamalısın. şüpheli bir durum gördüğünde hemen destek ekibine ulaşmalısın.',
  },
  {
    heading: '6. iptal ve iade',
    body: 'henüz başlamamış rezervasyonlar ücretsiz iptal edilebilir. başlamış bir seansın ücretini iade edemeyiz, ancak bir aksaklık olduysa destek ekibi durumu inceler.',
  },
  {
    heading: '7. değişiklikler',
    body: 'bu sözleşmeyi zaman zaman güncelleyebiliriz. önemli bir değişiklik olduğunda uygulama içinden bildirim göreceksin.',
  },
  {
    heading: '8. iletişim',
    body: 'sorular için destek@playbox.app — uygulama içinden de destek ekranından ulaşabilirsin.',
  },
];

export default function Terms() {
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
          koşullar
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
          kullanım koşulları
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
          son güncelleme: 26 nisan 2026 · sürüm 1.0
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
