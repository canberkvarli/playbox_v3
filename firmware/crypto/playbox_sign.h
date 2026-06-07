/*
 * playbox_sign — portable signing core for the Playbox firmware.
 *
 * Builds the canonical event/command strings and signs/verifies them with
 * HMAC-SHA256. Byte-for-byte compatible with the server-side signer
 * (supabase/functions/_shared). Plain C99, depends only on sha256.h.
 * Compiles on host (clang/cc) and on ESP32.
 *
 * Canonical strings:
 *   event:   ${event}|${gate}|${session_id}|${seq}|${ts}|${extra}
 *   command: ${cmd}|${gate}|${session_id}|${duration_min_or_0}|${ts}
 *
 * where gate is decimal digits or "" (absent), session_id is the string or
 * "" (absent), seq/ts are uint32 decimal, and extra is integer millivolts
 * (decimal) for battery_low/battery_critical events, "" otherwise.
 *
 * The HMAC key is the 32 RAW BYTES decoded from a 64-hex-char station secret
 * (not the utf8 string). Signatures are lowercase hex (64 chars), no 0x.
 */
#ifndef PLAYBOX_SIGN_H
#define PLAYBOX_SIGN_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* HMAC-SHA256 with a 32-byte key. Writes 64 lowercase hex chars + NUL. */
void playbox_hmac_sha256_hex(const uint8_t key[32], const char *msg,
                             char out_hex[65]);

/* Decode 64 hex chars into 32 raw bytes. Returns 0 on success, non-0 on
 * bad input (wrong length or non-hex character). */
int playbox_hex_decode_key(const char *hex64, uint8_t out[32]);

/* Build the exact event canonical string into buf.
 *   gate       <0  => absent ("")
 *   session_id NULL => absent ("")
 *   mv         <0  => absent ("") ; otherwise integer millivolts */
void playbox_event_canonical(char *buf, size_t buflen, const char *event,
                             int gate, const char *session_id,
                             uint32_t seq, uint32_t ts, long mv);

/* Build the exact command canonical string into buf.
 *   gate       <0  => absent ("")
 *   session_id NULL => absent ("")
 *   duration_min is rendered as decimal (0 for return_unlock). */
void playbox_command_canonical(char *buf, size_t buflen, const char *cmd,
                               int gate, const char *session_id,
                               uint32_t duration_min, uint32_t ts);

/* Canonicalize + sign an event. Writes 64 lowercase hex chars + NUL into
 * out_sig_hex. Returns 0 on success, non-0 if the canonical string would
 * not fit. */
int playbox_sign_event(const uint8_t key[32], const char *event, int gate,
                       const char *session_id, uint32_t seq, uint32_t ts,
                       long mv, char out_sig_hex[65]);

/* Recompute a command signature and compare (constant-time) against the
 * supplied lowercase-hex signature. Returns 1 if valid, 0 otherwise. */
int playbox_verify_command(const uint8_t key[32], const char *cmd, int gate,
                           const char *session_id, uint32_t duration_min,
                           uint32_t ts, const char *sig_hex);

#ifdef __cplusplus
}
#endif

#endif /* PLAYBOX_SIGN_H */
