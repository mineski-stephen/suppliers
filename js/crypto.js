const Crypto = (() => {
    const SALT_LEN = 16;
    const IV_LEN = 12;
    const ITERATIONS = 100000;

    async function deriveKey(password, salt, usage) {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]
        );
        return window.crypto.subtle.deriveKey(
            { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            false,
            usage
        );
    }

    async function encrypt(data, password) {
        const salt = window.crypto.getRandomValues(new Uint8Array(SALT_LEN));
        const iv = window.crypto.getRandomValues(new Uint8Array(IV_LEN));
        const key = await deriveKey(password, salt, ["encrypt"]);
        const encoded = typeof data === "string" ? new TextEncoder().encode(data) : data;
        const ciphertext = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv }, key, encoded
        );
        const result = new Uint8Array(SALT_LEN + IV_LEN + ciphertext.byteLength);
        result.set(salt, 0);
        result.set(iv, SALT_LEN);
        result.set(new Uint8Array(ciphertext), SALT_LEN + IV_LEN);
        return result.buffer;
    }

    async function decrypt(encryptedBuffer, password) {
        const data = new Uint8Array(encryptedBuffer);
        if (data.length < SALT_LEN + IV_LEN + 16) {
            throw new Error("Invalid encrypted data");
        }
        const salt = data.slice(0, SALT_LEN);
        const iv = data.slice(SALT_LEN, SALT_LEN + IV_LEN);
        const ciphertext = data.slice(SALT_LEN + IV_LEN);
        const key = await deriveKey(password, salt, ["decrypt"]);
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv }, key, ciphertext
        );
        return new TextDecoder().decode(decrypted);
    }

    return { encrypt, decrypt };
})();
