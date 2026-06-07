/*
 * playbox_sign — portable signing core for the Playbox firmware.
 * See playbox_sign.h for the contract. Plain C99, depends only on sha256.h.
 */
#include "playbox_sign.h"
#include "sha256.h"

#include <stdio.h>
#include <string.h>

static const char HEX_LC[16] = {
    '0', '1', '2', '3', '4', '5', '6', '7',
    '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'
};

static void bytes_to_hex_lc(const uint8_t *bytes, size_t n, char *out) {
    size_t i;
    for (i = 0; i < n; ++i) {
        out[i * 2]     = HEX_LC[(bytes[i] >> 4) & 0x0f];
        out[i * 2 + 1] = HEX_LC[bytes[i] & 0x0f];
    }
    out[n * 2] = '\0';
}

static int hex_nibble(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

int playbox_hex_decode_key(const char *hex64, uint8_t out[32]) {
    size_t i;
    if (hex64 == NULL) return 1;
    if (strlen(hex64) != 64) return 1;
    for (i = 0; i < 32; ++i) {
        int hi = hex_nibble(hex64[i * 2]);
        int lo = hex_nibble(hex64[i * 2 + 1]);
        if (hi < 0 || lo < 0) return 1;
        out[i] = (uint8_t)((hi << 4) | lo);
    }
    return 0;
}

void playbox_hmac_sha256_hex(const uint8_t key[32], const char *msg,
                             char out_hex[65]) {
    /* HMAC-SHA256. The key is exactly 32 bytes (< block size 64), so it is
     * zero-padded into the 64-byte block; no key hashing is required. */
    uint8_t k_ipad[64];
    uint8_t k_opad[64];
    uint8_t inner[SHA256_BLOCK_SIZE];
    uint8_t outer[SHA256_BLOCK_SIZE];
    SHA256_CTX ctx;
    size_t i;
    size_t msglen = msg ? strlen(msg) : 0;

    for (i = 0; i < 64; ++i) {
        uint8_t kb = (i < 32) ? key[i] : 0x00;
        k_ipad[i] = kb ^ 0x36;
        k_opad[i] = kb ^ 0x5c;
    }

    /* inner = SHA256(k_ipad || msg) */
    sha256_init(&ctx);
    sha256_update(&ctx, k_ipad, 64);
    if (msglen) sha256_update(&ctx, (const uint8_t *)msg, msglen);
    sha256_final(&ctx, inner);

    /* outer = SHA256(k_opad || inner) */
    sha256_init(&ctx);
    sha256_update(&ctx, k_opad, 64);
    sha256_update(&ctx, inner, SHA256_BLOCK_SIZE);
    sha256_final(&ctx, outer);

    bytes_to_hex_lc(outer, SHA256_BLOCK_SIZE, out_hex);
}

void playbox_event_canonical(char *buf, size_t buflen, const char *event,
                             int gate, const char *session_id,
                             uint32_t seq, uint32_t ts, long mv) {
    char gate_buf[16];
    char extra_buf[24];
    const char *sid = session_id ? session_id : "";

    if (gate < 0) {
        gate_buf[0] = '\0';
    } else {
        snprintf(gate_buf, sizeof(gate_buf), "%d", gate);
    }

    if (mv < 0) {
        extra_buf[0] = '\0';
    } else {
        snprintf(extra_buf, sizeof(extra_buf), "%ld", mv);
    }

    /* ${event}|${gate}|${session_id}|${seq}|${ts}|${extra} */
    snprintf(buf, buflen, "%s|%s|%s|%u|%u|%s",
             event, gate_buf, sid, (unsigned)seq, (unsigned)ts, extra_buf);
}

void playbox_command_canonical(char *buf, size_t buflen, const char *cmd,
                               int gate, const char *session_id,
                               uint32_t duration_min, uint32_t ts) {
    char gate_buf[16];
    const char *sid = session_id ? session_id : "";

    if (gate < 0) {
        gate_buf[0] = '\0';
    } else {
        snprintf(gate_buf, sizeof(gate_buf), "%d", gate);
    }

    /* ${cmd}|${gate}|${session_id}|${duration_min_or_0}|${ts} */
    snprintf(buf, buflen, "%s|%s|%s|%u|%u",
             cmd, gate_buf, sid, (unsigned)duration_min, (unsigned)ts);
}

int playbox_sign_event(const uint8_t key[32], const char *event, int gate,
                       const char *session_id, uint32_t seq, uint32_t ts,
                       long mv, char out_sig_hex[65]) {
    char canon[256];
    playbox_event_canonical(canon, sizeof(canon), event, gate, session_id,
                            seq, ts, mv);
    if (strlen(canon) >= sizeof(canon) - 1) return 1;
    playbox_hmac_sha256_hex(key, canon, out_sig_hex);
    return 0;
}

static int ct_equal_hex(const char *a, const char *b) {
    /* Constant-time-ish comparison over fixed 64-char lowercase hex. */
    size_t i;
    unsigned char diff = 0;
    if (a == NULL || b == NULL) return 0;
    if (strlen(a) != 64 || strlen(b) != 64) {
        /* still walk a fixed length to avoid early-out, then fail */
        diff = 1;
    }
    for (i = 0; i < 64; ++i) {
        char ca = a[i] ? a[i] : 0;
        char cb = b[i] ? b[i] : 0;
        diff |= (unsigned char)(ca ^ cb);
    }
    return diff == 0;
}

int playbox_verify_command(const uint8_t key[32], const char *cmd, int gate,
                           const char *session_id, uint32_t duration_min,
                           uint32_t ts, const char *sig_hex) {
    char canon[256];
    char expected[65];
    playbox_command_canonical(canon, sizeof(canon), cmd, gate, session_id,
                              duration_min, ts);
    playbox_hmac_sha256_hex(key, canon, expected);
    return ct_equal_hex(expected, sig_hex) ? 1 : 0;
}
