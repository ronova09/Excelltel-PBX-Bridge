const extensionMap = new Map();

function setExtensions(extensions) {
    extensionMap.clear();

    for (const [id, extension] of Object.entries(extensions)) {
        extensionMap.set(Number(id), extension);
    }
}

function getExtension(id) {
    if (extensionMap.has(id)) {
        return extensionMap.get(id);
    }

    return `UNKNOWN(${id.toString(16).padStart(2, '0')})`;
}

function getAllExtensions() {
    return Object.fromEntries(extensionMap);
}

module.exports = {
    setExtensions,
    getExtension,
    getAllExtensions
};