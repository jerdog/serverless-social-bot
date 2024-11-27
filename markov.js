class MarkovChain {
    constructor(stateSize = 2) {
        this.stateSize = stateSize;
        this.chain = new Map();
        this.startStates = [];
    }

    addData(text) {
        const words = text.split(/\s+/);
        if (words.length <= this.stateSize) return;

        // Add start states
        for (let i = 0; i <= words.length - this.stateSize; i++) {
            const state = words.slice(i, i + this.stateSize).join(' ');
            if (i === 0) this.startStates.push(state);

            const nextWord = words[i + this.stateSize];
            if (!nextWord) continue;

            if (!this.chain.has(state)) {
                this.chain.set(state, []);
            }
            this.chain.get(state).push(nextWord);
        }
    }

    generate(options = {}) {
        const {
            maxTries = 100,
            minChars = 100,
            maxChars = 280
        } = options;

        for (let tries = 0; tries < maxTries; tries++) {
            const result = this.generateOnce(minChars, maxChars);
            if (result) return result;
        }

        throw new Error('Failed to generate valid text within constraints');
    }

    generateOnce(minChars, maxChars) {
        if (this.startStates.length === 0) return null;

        const startState = this.startStates[Math.floor(Math.random() * this.startStates.length)];
        let currentState = startState;
        let result = startState;
        let words = startState.split(' ');

        while (result.length < maxChars) {
            const possibleNextWords = this.chain.get(currentState);
            if (!possibleNextWords || possibleNextWords.length === 0) break;

            const nextWord = possibleNextWords[Math.floor(Math.random() * possibleNextWords.length)];
            if (!nextWord) break;

            words.push(nextWord);
            result = words.join(' ');
            
            if (result.length > maxChars) {
                words.pop();
                break;
            }

            words = words.slice(-(this.stateSize));
            currentState = words.join(' ');
        }

        result = words.join(' ');
        return result.length >= minChars && result.length <= maxChars ? result : null;
    }
}

export default MarkovChain;
