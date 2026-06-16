// Template for the per-station HMAC secret. COMMITTED as a placeholder.
//
// Setup (per station):
//   1. cp station_secret.example.h station_secret.h
//   2. openssl rand -hex 32   ->  paste into STATION_SECRET_HEX below
//   3. Set the SAME value in Supabase:
//        supabase secrets set PLAYBOX_STATION_SECRET_DEV_001=<value>
//        supabase functions deploy sign-unlock
//
// station_secret.h is gitignored (firmware/*/station_secret.h) so the real
// secret never enters git. The firmware verifies unlock signatures the
// sign-unlock Edge Function produces with the matching key — both sides MUST
// hold the identical 64-hex (32-byte) value or every unlock is rejected.
#pragma once
#define STATION_SECRET_HEX "0000000000000000000000000000000000000000000000000000000000000000"
