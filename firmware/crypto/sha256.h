/*
 * SHA-256 implementation.
 *
 * Origin: Brad Conte (brad@bradconte.com), "crypto-algorithms" project.
 * Public domain. See: https://github.com/B-Con/crypto-algorithms
 *
 * "This code is released into the public domain free of any restrictions.
 *  The author requests acknowledgement if the code is used, but does not
 *  require it. This code is provided free of any liability and without any
 *  quality claims by the author."
 *
 * Plain C99, no external dependencies. Compiles on host (clang/cc) and ESP32.
 */
#ifndef PLAYBOX_SHA256_H
#define PLAYBOX_SHA256_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define SHA256_BLOCK_SIZE 32 /* SHA-256 digest size in bytes */

typedef struct {
    uint8_t  data[64];
    uint32_t datalen;
    uint64_t bitlen;
    uint32_t state[8];
} SHA256_CTX;

void sha256_init(SHA256_CTX *ctx);
void sha256_update(SHA256_CTX *ctx, const uint8_t *data, size_t len);
void sha256_final(SHA256_CTX *ctx, uint8_t hash[SHA256_BLOCK_SIZE]);

#ifdef __cplusplus
}
#endif

#endif /* PLAYBOX_SHA256_H */
