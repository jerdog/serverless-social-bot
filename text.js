// Small, composable text helpers shared across modules. Kept dependency-free.

// Remove HTML tags.
function stripHtml(text) {
    return text.replace(/<[^>]*>/g, '');
}

// Remove @mentions.
function stripMentions(text) {
    return text.replace(/@[\w]+/g, '');
}

// Collapse runs of whitespace to single spaces and trim.
function normalizeWhitespace(text) {
    return text.replace(/\s+/g, ' ').trim();
}

export { stripHtml, stripMentions, normalizeWhitespace };
