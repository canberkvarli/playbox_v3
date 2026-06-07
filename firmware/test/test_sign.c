/*
 * Host test for the Playbox portable signing core.
 *
 * Validates playbox_event_canonical / playbox_sign_event against the golden
 * vectors in supabase/functions/_shared/__fixtures__/event-signing-vectors.json
 * (mirrored below), plus command-signing vectors computed with node crypto.
 *
 * Build + run: see run.sh. Exits non-zero if any case fails.
 */
#include "../crypto/playbox_sign.h"

#include <stdio.h>
#include <string.h>

static int g_failures = 0;
static int g_total = 0;

#define SECRET_HEX \
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

typedef struct {
    const char *event;
    int         gate;       /* <0 = absent */
    const char *session_id; /* NULL = absent */
    uint32_t    seq;
    uint32_t    ts;
    long        mv;         /* <0 = absent */
    const char *canonical;
    const char *sig;
} EventVector;

/* Mirror of event-signing-vectors.json (all entries). */
static const EventVector EVENT_VECTORS[] = {
    { "gate_closed",      1,  "s1",  2, 100, -1,
      "gate_closed|1|s1|2|100|",
      "33414e3eb9a1788c3c19cf620e5d064cb549f5a8b377b02d465ff3285fd6fd85" },
    { "boot",            -1,  NULL,  1,  50, -1,
      "boot|||1|50|",
      "37785915bc2d36e877a1c77fcd51c5fe6c505c5afff411f719c5dd99313cbb32" },
    { "battery_low",     -1,  NULL,  7, 200, 11900,
      "battery_low|||7|200|11900",
      "ac24c55c0bae44c1c4b142c71f4657d1f1ce930e44d0421a302cc748811f50ea" },
    { "battery_critical", -1, NULL,  9, 300, 11500,
      "battery_critical|||9|300|11500",
      "d027eee69c1f7a49a7107e4ddda50ba9aff8bb940b8f60f230c5eaebe1c2f306" },
    { "unlock_timeout",  -1,  "s1",  5, 250, -1,
      "unlock_timeout||s1|5|250|",
      "e43d33ec10ecc05500ca5a3b0d04f7da2640c039ef7d7615e920333a0622ed7f" },
};
#define EVENT_VECTOR_COUNT (sizeof(EVENT_VECTORS) / sizeof(EVENT_VECTORS[0]))

typedef struct {
    const char *cmd;
    int         gate;
    const char *session_id;
    uint32_t    duration_min;
    uint32_t    ts;
    const char *canonical;
    const char *sig; /* computed with node crypto, pinned */
} CommandVector;

static const CommandVector COMMAND_VECTORS[] = {
    /* node -e: HMAC-SHA256(hexdecode(SECRET), "unlock|1|s1|30|1717600000") */
    { "unlock",        1, "s1", 30, 1717600000u,
      "unlock|1|s1|30|1717600000",
      "a21d4e52c3546f8faa9b0b9a22f96c309d80228b62bb52e5dfc9a2c869271d7b" },
    /* return_unlock uses duration 0 */
    { "return_unlock", 2, "s2",  0, 1717600500u,
      "return_unlock|2|s2|0|1717600500",
      NULL /* sig filled at runtime check vs verify only */ },
};
#define COMMAND_VECTOR_COUNT (sizeof(COMMAND_VECTORS) / sizeof(COMMAND_VECTORS[0]))

static void check_str(const char *label, const char *got, const char *want) {
    g_total++;
    if (strcmp(got, want) == 0) {
        printf("PASS %s\n", label);
    } else {
        g_failures++;
        printf("FAIL %s\n      got:  %s\n      want: %s\n", label, got, want);
    }
}

static void check_bool(const char *label, int cond) {
    g_total++;
    if (cond) {
        printf("PASS %s\n", label);
    } else {
        g_failures++;
        printf("FAIL %s\n", label);
    }
}

int main(void) {
    uint8_t key[32];
    size_t i;
    char buf[256];
    char sig[65];

    if (playbox_hex_decode_key(SECRET_HEX, key) != 0) {
        printf("FAIL hex decode of secret\n");
        return 1;
    }
    /* sanity: a bad key is rejected */
    {
        uint8_t junk[32];
        check_bool("hex_decode rejects short input",
                   playbox_hex_decode_key("00ff", junk) != 0);
        check_bool("hex_decode rejects non-hex",
                   playbox_hex_decode_key(
                       "zz112233445566778899aabbccddeeff"
                       "00112233445566778899aabbccddeeff", junk) != 0);
    }

    printf("--- event golden vectors (%zu) ---\n", EVENT_VECTOR_COUNT);
    for (i = 0; i < EVENT_VECTOR_COUNT; ++i) {
        const EventVector *v = &EVENT_VECTORS[i];
        char label[128];

        playbox_event_canonical(buf, sizeof(buf), v->event, v->gate,
                                v->session_id, v->seq, v->ts, v->mv);
        snprintf(label, sizeof(label), "[%zu] %s canonical", i, v->event);
        check_str(label, buf, v->canonical);

        if (playbox_sign_event(key, v->event, v->gate, v->session_id,
                               v->seq, v->ts, v->mv, sig) != 0) {
            g_total++; g_failures++;
            printf("FAIL [%zu] %s sign_event returned error\n", i, v->event);
        } else {
            snprintf(label, sizeof(label), "[%zu] %s sig", i, v->event);
            check_str(label, sig, v->sig);
        }
    }

    printf("--- command vectors (%zu) ---\n", COMMAND_VECTOR_COUNT);
    for (i = 0; i < COMMAND_VECTOR_COUNT; ++i) {
        const CommandVector *v = &COMMAND_VECTORS[i];
        char label[128];

        playbox_command_canonical(buf, sizeof(buf), v->cmd, v->gate,
                                  v->session_id, v->duration_min, v->ts);
        snprintf(label, sizeof(label), "[%zu] %s canonical", i, v->cmd);
        check_str(label, buf, v->canonical);

        if (v->sig != NULL) {
            /* verify accepts the pinned signature */
            snprintf(label, sizeof(label), "[%zu] %s verify accepts", i, v->cmd);
            check_bool(label,
                       playbox_verify_command(key, v->cmd, v->gate,
                                              v->session_id, v->duration_min,
                                              v->ts, v->sig) == 1);

            /* verify rejects a tampered signature (flip last hex char) */
            {
                char tampered[65];
                memcpy(tampered, v->sig, 65);
                tampered[63] = (tampered[63] == 'a') ? 'b' : 'a';
                snprintf(label, sizeof(label),
                         "[%zu] %s verify rejects tampered", i, v->cmd);
                check_bool(label,
                           playbox_verify_command(key, v->cmd, v->gate,
                                                  v->session_id,
                                                  v->duration_min, v->ts,
                                                  tampered) == 0);
            }
        } else {
            /* round-trip: sign via hmac, verify must accept it */
            playbox_hmac_sha256_hex(key, v->canonical, sig);
            snprintf(label, sizeof(label),
                     "[%zu] %s round-trip verify", i, v->cmd);
            check_bool(label,
                       playbox_verify_command(key, v->cmd, v->gate,
                                              v->session_id, v->duration_min,
                                              v->ts, sig) == 1);
        }
    }

    printf("--- %d/%d checks passed ---\n", g_total - g_failures, g_total);
    if (g_failures) {
        printf("RESULT: FAIL (%d failure(s))\n", g_failures);
        return 1;
    }
    printf("RESULT: ALL PASS\n");
    return 0;
}
