/**
 * A minimal MDL: one texture, one $cdmaterials folder, one skin family and
 * one mesh using the texture
 */
function buildMdl(textureName, cdmaterials) {
    const buffer = Buffer.alloc(1024)
    buffer.write("IDST", 0, "latin1")
    buffer.writeInt32LE(49, 4)
    const strings = 900
    buffer.write(`${cdmaterials}\0${textureName}\0`, strings, "latin1")

    // Texture struct at 400: name offset is relative to the struct
    buffer.writeInt32LE(1, 204)
    buffer.writeInt32LE(400, 208)
    buffer.writeInt32LE(strings + cdmaterials.length + 1 - 400, 400)
    // $cdmaterials: an array of offsets from the start of the file
    buffer.writeInt32LE(1, 212)
    buffer.writeInt32LE(470, 216)
    buffer.writeInt32LE(strings, 470)
    // Skin table: 1 family x 1 column -> texture 0
    buffer.writeInt32LE(1, 220)
    buffer.writeInt32LE(1, 224)
    buffer.writeInt32LE(480, 228)
    buffer.writeUInt16LE(0, 480)
    // Body part at 500 -> model at 520 -> mesh at 700 using column 0
    buffer.writeInt32LE(1, 232)
    buffer.writeInt32LE(500, 236)
    buffer.writeInt32LE(1, 504)
    buffer.writeInt32LE(20, 512)
    buffer.writeInt32LE(1, 520 + 72)
    buffer.writeInt32LE(180, 520 + 76)
    buffer.writeInt32LE(0, 700)
    return buffer
}

module.exports = { buildMdl }
