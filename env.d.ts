declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY?: string;
    EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY?: string;
  }
}
