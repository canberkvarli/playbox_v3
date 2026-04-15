import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { Feather } from '@expo/vector-icons';

import { useT } from '@/hooks/useT';
import { useTheme } from '@/hooks/useTheme';
import { hx } from '@/lib/haptics';
import { palette } from '@/constants/theme';

type StepKey = 'pick' | 'scan' | 'play' | 'return';

type StepConfig = {
  key: StepKey;
  icon: keyof typeof Feather.glyphMap;
  bg: string;
};

const STEPS: StepConfig[] = [
  { key: 'pick',   icon: 'grid',         bg: palette.mauve + '33' },
  { key: 'scan',   icon: 'camera',       bg: palette.coral + '33' },
  { key: 'play',   icon: 'play-circle',  bg: palette.butter },
  { key: 'return', icon: 'rotate-ccw',   bg: palette.ink + '26' },
];

export type StationTourSheetHandle = {
  open: () => void;
  close: () => void;
};

type Props = {
  onDismiss?: () => void;
};

export const StationTourSheet = forwardRef<StationTourSheetHandle, Props>(
  function StationTourSheet({ onDismiss }, ref) {
    const sheetRef = useRef<BottomSheet>(null);
    const { t } = useT();
    const theme = useTheme();

    useImperativeHandle(ref, () => ({
      open: () => sheetRef.current?.snapToIndex(0),
      close: () => sheetRef.current?.close(),
    }));

    const renderBackdrop = useCallback(
      (props: any) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.5}
          pressBehavior="close"
        />
      ),
      []
    );

    const onGotIt = async () => {
      await hx.press();
      sheetRef.current?.close();
      // onClose will fire onDismiss → markTourSeen
    };

    return (
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={['80%']}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        onClose={onDismiss}
        backgroundStyle={{ backgroundColor: theme.bg }}
        handleIndicatorStyle={{ backgroundColor: theme.fg + '44', width: 40, height: 4 }}
      >
        <BottomSheetScrollView
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: 32,
          }}
          showsVerticalScrollIndicator={false}
        >
          <Text className="font-mono text-ink/50 dark:text-paper/50 text-xs uppercase tracking-widest text-center">
            {t('tour.eyebrow')}
          </Text>
          <Text
            className="font-display-x text-ink dark:text-paper text-4xl text-center mt-2"
            style={{ lineHeight: 44 }}
          >
            {t('tour.title')}
          </Text>
          <Text className="font-sans text-ink/70 dark:text-paper/70 text-base text-center mt-3">
            {t('tour.sub')}
          </Text>

          <View className="mt-8" style={{ gap: 12 }}>
            {STEPS.map((step, i) => (
              <View
                key={step.key}
                className="bg-paper dark:bg-ink/40 rounded-3xl p-5 border border-ink/10 dark:border-paper/10"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}
              >
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: step.bg,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    className="font-display-x text-2xl"
                    style={{ color: palette.ink }}
                  >
                    {i + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text className="font-display text-ink dark:text-paper text-lg">
                    {t(`tour.steps.${step.key}.title`)}
                  </Text>
                  <Text className="font-sans text-ink/70 dark:text-paper/70 text-sm mt-1">
                    {t(`tour.steps.${step.key}.desc`)}
                  </Text>
                </View>
                <Feather name={step.icon} size={22} color={theme.fg + '99'} />
              </View>
            ))}
          </View>

          <Pressable
            onPress={onGotIt}
            accessibilityRole="button"
            accessibilityLabel={t('tour.cta')}
            className="bg-coral rounded-2xl py-4 mt-8"
            style={({ pressed }) => ({
              transform: [{ scale: pressed ? 0.98 : 1 }],
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Text className="text-paper font-semibold text-lg text-center">
              {t('tour.cta')}
            </Text>
          </Pressable>
        </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);
