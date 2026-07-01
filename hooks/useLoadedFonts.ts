import { useFonts } from 'expo-font';
import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';

export function useLoadedFonts() {
  const [loaded, error] = useFonts({
    // DISPLAY = Anton (punchy athletic grotesque). Loaded UNDER the legacy
    // `Unbounded_*` keys so every existing `fontFamily: 'Unbounded_700Bold'` /
    // `fontFamily: 'Unbounded_800ExtraBold'` and the `font-display`/`font-display-x`
    // tailwind classes render Anton — no need to edit the 31 files that
    // reference the old names. Anton ships a single 400 weight; both display
    // slots map to it.
    Unbounded_700Bold: Anton_400Regular,
    Unbounded_800ExtraBold: Anton_400Regular,
    // Body stays Inter, timers/station-IDs stay JetBrains Mono.
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });
  return { loaded, error };
}
