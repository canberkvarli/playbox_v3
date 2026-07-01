import { useFonts } from 'expo-font';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';

export function useLoadedFonts() {
  const [loaded, error] = useFonts({
    // DISPLAY = Archivo Expanded ("Wide Court") — wide athletic grotesque.
    // Loaded UNDER the legacy `Unbounded_*` keys so every existing
    // `fontFamily: 'Unbounded_700Bold'` / `'Unbounded_800ExtraBold'` and the
    // `font-display`/`font-display-x` tailwind classes render Archivo Expanded
    // with no per-file churn. ExtraBold slot → Black for the punchiest headlines.
    Unbounded_700Bold: require('../assets/fonts/ArchivoExpanded-Bold.ttf'),
    Unbounded_800ExtraBold: require('../assets/fonts/ArchivoExpanded-Black.ttf'),
    // A real alias too, for any new code that wants to be explicit.
    ArchivoExpanded_600SemiBold: require('../assets/fonts/ArchivoExpanded-SemiBold.ttf'),
    ArchivoExpanded_800ExtraBold: require('../assets/fonts/ArchivoExpanded-ExtraBold.ttf'),
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
