/**
 * Dynamic Question Generator
 * Generates random math and logic questions on-the-fly
 */

const QuestionGenerator = {
    /**
     * Generate a random addition question
     */
    generateAddition() {
        const a = Math.floor(Math.random() * 50) + 1;
        const b = Math.floor(Math.random() * 50) + 1;
        const correct = a + b;

        return {
            question: `What is ${a} + ${b}?`,
            correctAnswer: correct.toString(),
            wrongAnswers: [
                (correct + Math.floor(Math.random() * 10) + 1).toString(),
                (correct - Math.floor(Math.random() * 10) - 1).toString(),
                (correct + Math.floor(Math.random() * 20) + 10).toString()
            ]
        };
    },

    /**
     * Generate a random subtraction question
     */
    generateSubtraction() {
        const a = Math.floor(Math.random() * 50) + 20;
        const b = Math.floor(Math.random() * 20) + 1;
        const correct = a - b;

        return {
            question: `What is ${a} - ${b}?`,
            correctAnswer: correct.toString(),
            wrongAnswers: [
                (correct + Math.floor(Math.random() * 10) + 1).toString(),
                (correct - Math.floor(Math.random() * 10) - 1).toString(),
                (a + b).toString() // Common mistake: adding instead of subtracting
            ]
        };
    },

    /**
     * Generate a random multiplication question
     */
    generateMultiplication() {
        const a = Math.floor(Math.random() * 12) + 1;
        const b = Math.floor(Math.random() * 12) + 1;
        const correct = a * b;

        return {
            question: `What is ${a} × ${b}?`,
            correctAnswer: correct.toString(),
            wrongAnswers: [
                (correct + a).toString(),
                (correct - b).toString(),
                (a + b).toString() // Common mistake: adding instead of multiplying
            ]
        };
    },

    /**
     * Generate a random division question (always results in whole number)
     */
    generateDivision() {
        const b = Math.floor(Math.random() * 10) + 2;
        const correct = Math.floor(Math.random() * 12) + 1;
        const a = b * correct; // Ensure whole number result

        return {
            question: `What is ${a} ÷ ${b}?`,
            correctAnswer: correct.toString(),
            wrongAnswers: [
                (correct + 1).toString(),
                (correct - 1).toString(),
                b.toString() // Common mistake: reversing the division
            ]
        };
    },

    /**
     * Generate a percentage question
     */
    generatePercentage() {
        const percentage = [10, 20, 25, 50, 75][Math.floor(Math.random() * 5)];
        const total = [100, 200, 400, 500, 1000][Math.floor(Math.random() * 5)];
        const correct = (percentage / 100) * total;

        return {
            question: `What is ${percentage}% of ${total}?`,
            correctAnswer: correct.toString(),
            wrongAnswers: [
                (correct * 2).toString(),
                (correct / 2).toString(),
                (total - correct).toString()
            ]
        };
    },

    /**
     * Generate a square number question
     */
    generateSquare() {
        const base = Math.floor(Math.random() * 15) + 1;
        const correct = base * base;

        return {
            question: `What is ${base}²?`,
            correctAnswer: correct.toString(),
            wrongAnswers: [
                (base * 2).toString(),
                (correct + base).toString(),
                (correct - base).toString()
            ]
        };
    },

    /**
     * Generate a number sequence question
     */
    generateSequence() {
        const types = ['even', 'odd', 'multiply'];
        const type = types[Math.floor(Math.random() * types.length)];

        if (type === 'even') {
            const start = Math.floor(Math.random() * 10) * 2;
            const sequence = [start, start + 2, start + 4, start + 6];
            const correct = start + 8;

            return {
                question: `Complete the sequence: ${sequence.join(', ')}, ?`,
                correctAnswer: correct.toString(),
                wrongAnswers: [
                    (correct + 1).toString(),
                    (correct + 2).toString(),
                    (correct - 2).toString()
                ]
            };
        } else if (type === 'odd') {
            const start = Math.floor(Math.random() * 10) * 2 + 1;
            const sequence = [start, start + 2, start + 4, start + 6];
            const correct = start + 8;

            return {
                question: `Complete the sequence: ${sequence.join(', ')}, ?`,
                correctAnswer: correct.toString(),
                wrongAnswers: [
                    (correct + 1).toString(),
                    (correct + 2).toString(),
                    (correct - 2).toString()
                ]
            };
        } else {
            const multiplier = Math.floor(Math.random() * 3) + 2;
            const start = Math.floor(Math.random() * 5) + 1;
            const sequence = [start, start * multiplier, start * multiplier * multiplier];
            const correct = start * multiplier * multiplier * multiplier;

            return {
                question: `Complete the sequence: ${sequence.join(', ')}, ?`,
                correctAnswer: correct.toString(),
                wrongAnswers: [
                    (correct + multiplier).toString(),
                    (sequence[2] + multiplier).toString(),
                    (correct * 2).toString()
                ]
            };
        }
    },

    /**
     * Generate a comparison question
     */
    generateComparison() {
        const operations = [
            { a: 15, b: 20, op: '<', text: 'less than' },
            { a: 30, b: 25, op: '>', text: 'greater than' },
            { a: 10, b: 10, op: '=', text: 'equal to' }
        ];

        const op = operations[Math.floor(Math.random() * operations.length)];
        const offset = Math.floor(Math.random() * 10) + 1;

        return {
            question: `Is ${op.a} ${op.text} ${op.b}?`,
            correctAnswer: op.op === '<' ? 'Yes' : op.op === '>' ? 'Yes' : 'Yes',
            wrongAnswers: ['No', 'Maybe', 'Cannot determine']
        };
    },

    /**
     * Generate a time calculation question
     */
    generateTime() {
        const hours = Math.floor(Math.random() * 12) + 1;
        const minutes = [15, 30, 45][Math.floor(Math.random() * 3)];
        const totalMinutes = hours * 60 + minutes;

        return {
            question: `How many minutes are in ${hours} hours and ${minutes} minutes?`,
            correctAnswer: totalMinutes.toString(),
            wrongAnswers: [
                (totalMinutes + 60).toString(),
                (totalMinutes - 30).toString(),
                (hours * 100 + minutes).toString()
            ]
        };
    },

    /**
     * Generate a random dynamic question
     */
    generateRandom() {
        const generators = [
            this.generateAddition,
            this.generateSubtraction,
            this.generateMultiplication,
            this.generateDivision,
            this.generatePercentage,
            this.generateSquare,
            this.generateSequence,
            this.generateTime
        ];

        const generator = generators[Math.floor(Math.random() * generators.length)];
        return generator.call(this);
    },

    /**
     * Generate multiple random questions
     * @param {number} count - Number of questions to generate
     */
    generateMultiple(count) {
        const questions = [];
        for (let i = 0; i < count; i++) {
            questions.push(this.generateRandom());
        }
        return questions;
    }
};

// Export for use in quiz-battle.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QuestionGenerator;
}
