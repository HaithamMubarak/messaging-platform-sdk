/**
 * Find the Liar - Question/Topic Generator
 *
 * Provides fun, office-friendly questions/topics for the game.
 * Questions are designed to be:
 * - Easy to answer quickly
 * - Hard for the liar to blend in
 * - Office-appropriate and fun
 */

// Question categories - Office-friendly topics for Find the Liar
// Using var instead of const to allow window assignment
var QUESTION_CATEGORIES = {
    WEEKEND: {
        name: 'Weekend Activities',
        icon: '🏖️',
        questions: [
            "What did you do last weekend?",
            "Describe your perfect weekend morning.",
            "What's your favorite weekend activity?",
            "How do you usually spend Sunday evenings?",
            "What's the last thing you did outdoors on a weekend?"
        ]
    },
    FOOD: {
        name: 'Food & Eating',
        icon: '🍕',
        questions: [
            "What did you have for breakfast today?",
            "Describe your go-to comfort food.",
            "What's the last thing you cooked at home?",
            "What food could you eat every day?",
            "What's your favorite snack at work?",
            "Describe your ideal lunch break meal."
        ]
    },
    WORK: {
        name: 'Work Life',
        icon: '💼',
        questions: [
            "What's your morning work routine?",
            "Describe your desk setup in 3 words.",
            "What do you do during your lunch break?",
            "What's your favorite thing about your job?",
            "Describe your commute to work.",
            "What's the first thing you do when you get to work?"
        ]
    },
    ENTERTAINMENT: {
        name: 'Entertainment',
        icon: '🎬',
        questions: [
            "What's the last movie you watched?",
            "What show are you currently binging?",
            "Describe your favorite music genre.",
            "What's the last song you had stuck in your head?",
            "What game have you played recently?",
            "What book are you reading (or want to read)?"
        ]
    },
    PERSONAL: {
        name: 'Personal',
        icon: '🌟',
        questions: [
            "What's your hidden talent?",
            "Describe your morning routine in one sentence.",
            "What's something you're looking forward to?",
            "What's a small thing that makes you happy?",
            "Describe your ideal vacation spot.",
            "What hobby do you want to try?",
            "What's the last thing that made you laugh?"
        ]
    },
    HYPOTHETICAL: {
        name: 'Hypothetical',
        icon: '💭',
        questions: [
            "If you won the lottery, what's the first thing you'd buy?",
            "If you could have any superpower, what would it be?",
            "If you could travel anywhere tomorrow, where?",
            "If you could have dinner with anyone, who?",
            "If you had an extra hour each day, how would you use it?",
            "If you could learn any skill instantly, what would it be?"
        ]
    },
    FAVORITES: {
        name: 'Favorites',
        icon: '❤️',
        questions: [
            "What's your favorite season and why?",
            "Describe your favorite holiday tradition.",
            "What's your favorite way to relax?",
            "What's your favorite room in your home?",
            "What's your favorite thing about this time of year?",
            "What's your favorite childhood memory?"
        ]
    }
};

/**
 * QuestionManager - Handles question selection and rotation
 */
class QuestionManager {
    constructor() {
        this.usedQuestions = new Set();
        this.categories = Object.keys(QUESTION_CATEGORIES);
    }

    /**
     * Get a random question that hasn't been used recently
     * @returns {Object} Question object with category, icon, and question text
     */
    getRandomQuestion() {
        // If we've used most questions, reset the pool
        const totalQuestions = this.categories.reduce((sum, cat) =>
            sum + QUESTION_CATEGORIES[cat].questions.length, 0);

        if (this.usedQuestions.size > totalQuestions * 0.8) {
            this.usedQuestions.clear();
        }

        // Pick a random category
        const categoryKey = this.categories[Math.floor(Math.random() * this.categories.length)];
        const category = QUESTION_CATEGORIES[categoryKey];

        // Get available questions from this category
        const availableQuestions = category.questions.filter(q => !this.usedQuestions.has(q));

        // If no available questions in this category, try another
        if (availableQuestions.length === 0) {
            // Recursive call with different category selection
            return this.getRandomQuestion();
        }

        // Pick a random question
        const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
        this.usedQuestions.add(question);

        return {
            category: category.name,
            icon: category.icon,
            question: question
        };
    }

    /**
     * Reset the used questions pool
     */
    reset() {
        this.usedQuestions.clear();
    }

    /**
     * Get all categories with their question counts
     * @returns {Array} Array of category info objects
     */
    getCategoryInfo() {
        return this.categories.map(key => ({
            key,
            name: QUESTION_CATEGORIES[key].name,
            icon: QUESTION_CATEGORIES[key].icon,
            count: QUESTION_CATEGORIES[key].questions.length
        }));
    }
}

// Export for use in main game file
window.QuestionManager = QuestionManager;
window.QUESTION_CATEGORIES = QUESTION_CATEGORIES;
