/**
 * Find the Liar - Items Database
 *
 * Each item has:
 * - id: unique identifier
 * - name: the SECRET item name (only non-liars see this)
 * - imageUrl: optional image (only non-liars see this)
 * - category: general category (liar sees this)
 * - hints: 2-4 clues for the liar (liar sees these instead of the name)
 *
 * Questions are shared across all items - they're generic enough to work with any item.
 */

// ============================================
// ITEM DATABASE (50 items)
// ============================================

const ITEM_DATABASE = [
    // ===== FOOD & DRINKS (10 items) =====
    {
        id: 'food-001',
        name: 'Pizza',
        imageUrl: '🍕',
        category: 'Food',
        hints: ['Italian origin', 'Usually round', 'Has toppings', 'Baked in oven']
    },
    {
        id: 'food-002',
        name: 'Sushi',
        imageUrl: '🍣',
        category: 'Food',
        hints: ['Japanese cuisine', 'Contains rice', 'Often raw fish', 'Eaten with chopsticks']
    },
    {
        id: 'food-003',
        name: 'Hamburger',
        imageUrl: '🍔',
        category: 'Food',
        hints: ['American classic', 'Has a bun', 'Ground meat patty', 'Fast food staple']
    },
    {
        id: 'food-004',
        name: 'Ice Cream',
        imageUrl: '🍦',
        category: 'Dessert',
        hints: ['Frozen treat', 'Many flavors', 'Often in a cone', 'Made with dairy']
    },
    {
        id: 'food-005',
        name: 'Coffee',
        imageUrl: '☕',
        category: 'Beverage',
        hints: ['Hot drink', 'Contains caffeine', 'Made from beans', 'Morning ritual']
    },
    {
        id: 'food-006',
        name: 'Tacos',
        imageUrl: '🌮',
        category: 'Food',
        hints: ['Mexican dish', 'Folded shell', 'Various fillings', 'Handheld meal']
    },
    {
        id: 'food-007',
        name: 'Chocolate Cake',
        imageUrl: '🍰',
        category: 'Dessert',
        hints: ['Sweet treat', 'Layered dessert', 'Dark colored', 'Birthday favorite']
    },
    {
        id: 'food-008',
        name: 'Orange Juice',
        imageUrl: '🧃',
        category: 'Beverage',
        hints: ['Citrus drink', 'Vitamin C rich', 'Breakfast staple', 'Yellow-orange color']
    },
    {
        id: 'food-009',
        name: 'Pasta',
        imageUrl: '🍝',
        category: 'Food',
        hints: ['Italian staple', 'Made from wheat', 'Many shapes', 'Served with sauce']
    },
    {
        id: 'food-010',
        name: 'Popcorn',
        imageUrl: '🍿',
        category: 'Snack',
        hints: ['Movie theater snack', 'Kernels that pop', 'Light and fluffy', 'Can be salty or sweet']
    },

    // ===== ANIMALS (10 items) =====
    {
        id: 'animal-001',
        name: 'Elephant',
        imageUrl: '🐘',
        category: 'Animal',
        hints: ['Very large', 'Has a trunk', 'Lives in Africa/Asia', 'Gray colored']
    },
    {
        id: 'animal-002',
        name: 'Penguin',
        imageUrl: '🐧',
        category: 'Animal',
        hints: ['Flightless bird', 'Black and white', 'Lives in cold regions', 'Excellent swimmer']
    },
    {
        id: 'animal-003',
        name: 'Lion',
        imageUrl: '🦁',
        category: 'Animal',
        hints: ['Big cat', 'King of jungle', 'Has a mane', 'Lives in Africa']
    },
    {
        id: 'animal-004',
        name: 'Dolphin',
        imageUrl: '🐬',
        category: 'Animal',
        hints: ['Marine mammal', 'Very intelligent', 'Makes clicking sounds', 'Playful nature']
    },
    {
        id: 'animal-005',
        name: 'Butterfly',
        imageUrl: '🦋',
        category: 'Insect',
        hints: ['Flying insect', 'Colorful wings', 'Was a caterpillar', 'Visits flowers']
    },
    {
        id: 'animal-006',
        name: 'Owl',
        imageUrl: '🦉',
        category: 'Animal',
        hints: ['Nocturnal bird', 'Can rotate head', 'Says "hoo"', 'Symbol of wisdom']
    },
    {
        id: 'animal-007',
        name: 'Kangaroo',
        imageUrl: '🦘',
        category: 'Animal',
        hints: ['Australian native', 'Hops to move', 'Has a pouch', 'Strong tail']
    },
    {
        id: 'animal-008',
        name: 'Octopus',
        imageUrl: '🐙',
        category: 'Animal',
        hints: ['Sea creature', 'Eight arms', 'Can change color', 'Very intelligent']
    },
    {
        id: 'animal-009',
        name: 'Giraffe',
        imageUrl: '🦒',
        category: 'Animal',
        hints: ['Tallest animal', 'Long neck', 'Spotted pattern', 'African native']
    },
    {
        id: 'animal-010',
        name: 'Panda',
        imageUrl: '🐼',
        category: 'Animal',
        hints: ['Black and white bear', 'Eats bamboo', 'From China', 'Endangered species']
    },

    // ===== OBJECTS & TOOLS (10 items) =====
    {
        id: 'object-001',
        name: 'Umbrella',
        imageUrl: '☂️',
        category: 'Object',
        hints: ['Weather protection', 'Opens and closes', 'Has a handle', 'Keeps you dry']
    },
    {
        id: 'object-002',
        name: 'Bicycle',
        imageUrl: '🚲',
        category: 'Vehicle',
        hints: ['Two wheels', 'Human powered', 'Has pedals', 'Eco-friendly transport']
    },
    {
        id: 'object-003',
        name: 'Guitar',
        imageUrl: '🎸',
        category: 'Instrument',
        hints: ['String instrument', 'Has a neck', 'Played with fingers', 'Makes music']
    },
    {
        id: 'object-004',
        name: 'Camera',
        imageUrl: '📷',
        category: 'Electronics',
        hints: ['Takes pictures', 'Has a lens', 'Captures memories', 'Click sound']
    },
    {
        id: 'object-005',
        name: 'Scissors',
        imageUrl: '✂️',
        category: 'Tool',
        hints: ['Cutting tool', 'Two blades', 'Has handles', 'Used for paper']
    },
    {
        id: 'object-006',
        name: 'Telescope',
        imageUrl: '🔭',
        category: 'Instrument',
        hints: ['For viewing far', 'Has lenses', 'Used at night', 'See stars']
    },
    {
        id: 'object-007',
        name: 'Backpack',
        imageUrl: '🎒',
        category: 'Object',
        hints: ['Carries things', 'Worn on back', 'Has straps', 'Students use it']
    },
    {
        id: 'object-008',
        name: 'Candle',
        imageUrl: '🕯️',
        category: 'Object',
        hints: ['Produces light', 'Made of wax', 'Has a wick', 'Can be scented']
    },
    {
        id: 'object-009',
        name: 'Clock',
        imageUrl: '🕐',
        category: 'Object',
        hints: ['Tells time', 'Has hands or digits', 'Ticks', 'Wall or desk']
    },
    {
        id: 'object-010',
        name: 'Key',
        imageUrl: '🔑',
        category: 'Object',
        hints: ['Opens locks', 'Metal object', 'Unique shape', 'Small and portable']
    },

    // ===== PLACES & LANDMARKS (10 items) =====
    {
        id: 'place-001',
        name: 'Eiffel Tower',
        imageUrl: '🗼',
        category: 'Landmark',
        hints: ['In Paris', 'Made of iron', 'Very tall', 'French symbol']
    },
    {
        id: 'place-002',
        name: 'Beach',
        imageUrl: '🏖️',
        category: 'Place',
        hints: ['Sandy area', 'Near water', 'Vacation spot', 'Waves crash here']
    },
    {
        id: 'place-003',
        name: 'Library',
        imageUrl: '📚',
        category: 'Place',
        hints: ['Full of books', 'Quiet place', 'Can borrow items', 'Study location']
    },
    {
        id: 'place-004',
        name: 'Hospital',
        imageUrl: '🏥',
        category: 'Place',
        hints: ['Medical facility', 'Doctors work here', 'Emergency room', 'Healing place']
    },
    {
        id: 'place-005',
        name: 'Mountain',
        imageUrl: '⛰️',
        category: 'Nature',
        hints: ['Very high', 'People climb it', 'Has a peak', 'Snow on top']
    },
    {
        id: 'place-006',
        name: 'Cinema',
        imageUrl: '🎬',
        category: 'Place',
        hints: ['Watch movies', 'Big screen', 'Dark room', 'Buy popcorn here']
    },
    {
        id: 'place-007',
        name: 'Airport',
        imageUrl: '✈️',
        category: 'Place',
        hints: ['Planes land here', 'Travel hub', 'Security checks', 'Departure gates']
    },
    {
        id: 'place-008',
        name: 'Gym',
        imageUrl: '🏋️',
        category: 'Place',
        hints: ['Exercise location', 'Has equipment', 'Get fit here', 'Weights and machines']
    },
    {
        id: 'place-009',
        name: 'Castle',
        imageUrl: '🏰',
        category: 'Building',
        hints: ['Medieval structure', 'Has towers', 'Royalty lived here', 'Stone walls']
    },
    {
        id: 'place-010',
        name: 'Volcano',
        imageUrl: '🌋',
        category: 'Nature',
        hints: ['Can erupt', 'Hot lava inside', 'Mountain type', 'Dangerous natural']
    },

    // ===== ACTIVITIES & SPORTS (10 items) =====
    {
        id: 'activity-001',
        name: 'Soccer',
        imageUrl: '⚽',
        category: 'Sport',
        hints: ['Ball sport', 'Kick with feet', '11 players per team', 'Has a goal']
    },
    {
        id: 'activity-002',
        name: 'Swimming',
        imageUrl: '🏊',
        category: 'Sport',
        hints: ['In water', 'Uses all limbs', 'Pool or ocean', 'Olympic event']
    },
    {
        id: 'activity-003',
        name: 'Camping',
        imageUrl: '🏕️',
        category: 'Activity',
        hints: ['Outdoor sleeping', 'Use a tent', 'In nature', 'Campfire often']
    },
    {
        id: 'activity-004',
        name: 'Dancing',
        imageUrl: '💃',
        category: 'Activity',
        hints: ['Move to music', 'Many styles', 'Can be solo or partner', 'At parties']
    },
    {
        id: 'activity-005',
        name: 'Fishing',
        imageUrl: '🎣',
        category: 'Activity',
        hints: ['Catch fish', 'Use a rod', 'Near water', 'Requires patience']
    },
    {
        id: 'activity-006',
        name: 'Skiing',
        imageUrl: '⛷️',
        category: 'Sport',
        hints: ['Winter sport', 'On snow', 'Downhill motion', 'Mountain activity']
    },
    {
        id: 'activity-007',
        name: 'Yoga',
        imageUrl: '🧘',
        category: 'Activity',
        hints: ['Stretching poses', 'Meditation included', 'Flexibility focus', 'Mat required']
    },
    {
        id: 'activity-008',
        name: 'Basketball',
        imageUrl: '🏀',
        category: 'Sport',
        hints: ['Ball through hoop', 'Indoor court', 'Dribbling', 'Tall players advantage']
    },
    {
        id: 'activity-009',
        name: 'Cooking',
        imageUrl: '👨‍🍳',
        category: 'Activity',
        hints: ['Prepare food', 'In kitchen', 'Use heat', 'Follow recipes']
    },
    {
        id: 'activity-010',
        name: 'Reading',
        imageUrl: '📖',
        category: 'Activity',
        hints: ['With a book', 'Use your eyes', 'Learn or enjoy', 'Quiet activity']
    },

    // ===== WEATHER & NATURE (10 items) =====
    {
        id: 'nature-001',
        name: 'Rainbow',
        imageUrl: '🌈',
        category: 'Weather',
        hints: ['Appears after rain', 'Multiple colors', 'Arc shape', 'In the sky']
    },
    {
        id: 'nature-002',
        name: 'Sunset',
        imageUrl: '🌅',
        category: 'Nature',
        hints: ['Happens daily', 'End of day', 'Sky turns orange', 'Beautiful view']
    },
    {
        id: 'nature-003',
        name: 'Ocean',
        imageUrl: '🌊',
        category: 'Nature',
        hints: ['Very large water', 'Salty', 'Has waves', 'Covers most Earth']
    },
    {
        id: 'nature-004',
        name: 'Tree',
        imageUrl: '🌳',
        category: 'Nature',
        hints: ['Tall plant', 'Has leaves', 'Wooden trunk', 'Provides shade']
    },
    {
        id: 'nature-005',
        name: 'Snowflake',
        imageUrl: '❄️',
        category: 'Weather',
        hints: ['Winter item', 'Cold and white', 'Falls from sky', 'Melts quickly']
    },
    {
        id: 'nature-006',
        name: 'Lightning',
        imageUrl: '⚡',
        category: 'Weather',
        hints: ['During storms', 'Very bright', 'Electric discharge', 'Thunder follows']
    },
    {
        id: 'nature-007',
        name: 'Moon',
        imageUrl: '🌙',
        category: 'Space',
        hints: ['Visible at night', 'Orbits Earth', 'Reflects light', 'Changes shape']
    },
    {
        id: 'nature-008',
        name: 'Sun',
        imageUrl: '☀️',
        category: 'Space',
        hints: ['Very hot', 'In center of system', 'Provides light', 'See during day']
    },
    {
        id: 'nature-009',
        name: 'Flower',
        imageUrl: '🌸',
        category: 'Nature',
        hints: ['Plant part', 'Colorful', 'Nice smell', 'Has petals']
    },
    {
        id: 'nature-010',
        name: 'Star',
        imageUrl: '⭐',
        category: 'Space',
        hints: ['Visible at night', 'Twinkles', 'Very far away', 'Many in sky']
    },

    // ===== TECHNOLOGY (10 items) =====
    {
        id: 'tech-001',
        name: 'Smartphone',
        imageUrl: '📱',
        category: 'Technology',
        hints: ['Handheld device', 'Makes calls', 'Has apps', 'Touchscreen']
    },
    {
        id: 'tech-002',
        name: 'Laptop',
        imageUrl: '💻',
        category: 'Technology',
        hints: ['Portable computer', 'Has keyboard', 'Opens and closes', 'For work or play']
    },
    {
        id: 'tech-003',
        name: 'Headphones',
        imageUrl: '🎧',
        category: 'Technology',
        hints: ['Audio device', 'Wear on ears', 'Listen privately', 'Has a wire or wireless']
    },
    {
        id: 'tech-004',
        name: 'Television',
        imageUrl: '📺',
        category: 'Technology',
        hints: ['Large screen', 'Watch shows', 'In living room', 'Remote control']
    },
    {
        id: 'tech-005',
        name: 'Video Game',
        imageUrl: '🎮',
        category: 'Technology',
        hints: ['Interactive entertainment', 'Use controller', 'On console or PC', 'Many genres']
    },
    {
        id: 'tech-006',
        name: 'Robot',
        imageUrl: '🤖',
        category: 'Technology',
        hints: ['Automated machine', 'Can be programmed', 'Often humanoid', 'Does tasks']
    },
    {
        id: 'tech-007',
        name: 'Rocket',
        imageUrl: '🚀',
        category: 'Technology',
        hints: ['Goes to space', 'Very fast', 'Launches vertically', 'Uses fuel']
    },
    {
        id: 'tech-008',
        name: 'Lightbulb',
        imageUrl: '💡',
        category: 'Technology',
        hints: ['Produces light', 'Screws in socket', 'Uses electricity', 'Glass exterior']
    },
    {
        id: 'tech-009',
        name: 'Microphone',
        imageUrl: '🎤',
        category: 'Technology',
        hints: ['Audio input', 'For singing or speaking', 'Captures sound', 'Used by performers']
    },
    {
        id: 'tech-010',
        name: 'Battery',
        imageUrl: '🔋',
        category: 'Technology',
        hints: ['Stores energy', 'Powers devices', 'Can be recharged', 'Different sizes']
    },

    // ===== TRANSPORTATION (10 items) =====
    {
        id: 'transport-001',
        name: 'Car',
        imageUrl: '🚗',
        category: 'Vehicle',
        hints: ['Four wheels', 'Has engine', 'Drives on roads', 'Seats passengers']
    },
    {
        id: 'transport-002',
        name: 'Train',
        imageUrl: '🚂',
        category: 'Vehicle',
        hints: ['On tracks', 'Multiple cars', 'Long distance', 'Station stops']
    },
    {
        id: 'transport-003',
        name: 'Airplane',
        imageUrl: '✈️',
        category: 'Vehicle',
        hints: ['Flies high', 'Has wings', 'Very fast', 'Carries many people']
    },
    {
        id: 'transport-004',
        name: 'Boat',
        imageUrl: '⛵',
        category: 'Vehicle',
        hints: ['On water', 'Has sail or motor', 'Floats', 'For travel or fishing']
    },
    {
        id: 'transport-005',
        name: 'Bus',
        imageUrl: '🚌',
        category: 'Vehicle',
        hints: ['Public transport', 'Many seats', 'Scheduled routes', 'Has stops']
    },
    {
        id: 'transport-006',
        name: 'Helicopter',
        imageUrl: '🚁',
        category: 'Vehicle',
        hints: ['Can hover', 'Spinning blades on top', 'Vertical takeoff', 'Loud noise']
    },
    {
        id: 'transport-007',
        name: 'Motorcycle',
        imageUrl: '🏍️',
        category: 'Vehicle',
        hints: ['Two wheels', 'Has engine', 'Faster than bicycle', 'Wear helmet']
    },
    {
        id: 'transport-008',
        name: 'Hot Air Balloon',
        imageUrl: '🎈',
        category: 'Vehicle',
        hints: ['Floats in air', 'Large and colorful', 'Uses hot air', 'Basket below']
    },
    {
        id: 'transport-009',
        name: 'Skateboard',
        imageUrl: '🛹',
        category: 'Vehicle',
        hints: ['Small board', 'Four wheels', 'Do tricks', 'Push with foot']
    },
    {
        id: 'transport-010',
        name: 'Submarine',
        imageUrl: '🛸',
        category: 'Vehicle',
        hints: ['Underwater vessel', 'Can dive deep', 'Airtight', 'Military or research']
    }
];

// ============================================
// QUESTION BANK - Hybrid System (MCQ + FREE_TEXT)
// ============================================

const QuestionType = {
    MCQ: 'MULTIPLE_CHOICE',
    FREE_TEXT: 'FREE_TEXT'
};

const QUESTION_BANK = [
    // ===== MULTIPLE CHOICE QUESTIONS (~70%) =====
    {
        id: 'mcq-01',
        type: QuestionType.MCQ,
        text: "What category does this belong to?",
        icon: '📂',
        timeLimitSeconds: 20,
        options: [
            { id: 'opt-food', text: 'Food & Drink' },
            { id: 'opt-animal', text: 'Animal' },
            { id: 'opt-object', text: 'Object/Tool' },
            { id: 'opt-place', text: 'Place' },
            { id: 'opt-activity', text: 'Activity/Sport' },
            { id: 'opt-nature', text: 'Nature/Weather' },
            { id: 'opt-tech', text: 'Technology' },
            { id: 'opt-vehicle', text: 'Vehicle' }
        ]
        // correctOptionId set dynamically based on item category
    },
    {
        id: 'mcq-02',
        type: QuestionType.MCQ,
        text: "Where would you most likely find this?",
        icon: '📍',
        timeLimitSeconds: 20,
        options: [
            { id: 'opt-home', text: 'At home' },
            { id: 'opt-store', text: 'At a store' },
            { id: 'opt-outdoor', text: 'Outdoors' },
            { id: 'opt-restaurant', text: 'At a restaurant' },
            { id: 'opt-office', text: 'At an office' },
            { id: 'opt-wild', text: 'In the wild' }
        ]
    },
    {
        id: 'mcq-03',
        type: QuestionType.MCQ,
        text: "What is the primary color?",
        icon: '🎨',
        timeLimitSeconds: 20,
        options: [
            { id: 'opt-red', text: 'Red' },
            { id: 'opt-blue', text: 'Blue' },
            { id: 'opt-green', text: 'Green' },
            { id: 'opt-yellow', text: 'Yellow' },
            { id: 'opt-brown', text: 'Brown' },
            { id: 'opt-white', text: 'White' },
            { id: 'opt-black', text: 'Black' },
            { id: 'opt-multi', text: 'Multiple colors' }
        ]
    },
    {
        id: 'mcq-04',
        type: QuestionType.MCQ,
        text: "How big is this typically?",
        icon: '📏',
        timeLimitSeconds: 20,
        options: [
            { id: 'opt-tiny', text: 'Tiny (fits in hand)' },
            { id: 'opt-small', text: 'Small (like a book)' },
            { id: 'opt-medium', text: 'Medium (like a chair)' },
            { id: 'opt-large', text: 'Large (like a car)' },
            { id: 'opt-huge', text: 'Huge (like a building)' }
        ]
    },
    {
        id: 'mcq-05',
        type: QuestionType.MCQ,
        text: "Can you eat or drink this?",
        icon: '🍽️',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-yes-eat', text: 'Yes, you can eat it' },
            { id: 'opt-yes-drink', text: 'Yes, you can drink it' },
            { id: 'opt-no', text: 'No, not edible' }
        ]
    },
    {
        id: 'mcq-06',
        type: QuestionType.MCQ,
        text: "Is this natural or man-made?",
        icon: '🏭',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-natural', text: 'Natural' },
            { id: 'opt-manmade', text: 'Man-made' },
            { id: 'opt-both', text: 'Both/Hybrid' }
        ]
    },
    {
        id: 'mcq-07',
        type: QuestionType.MCQ,
        text: "Does this make sound?",
        icon: '🔊',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-loud', text: 'Yes, loud' },
            { id: 'opt-quiet', text: 'Yes, quiet' },
            { id: 'opt-silent', text: 'No, silent' }
        ]
    },
    {
        id: 'mcq-08',
        type: QuestionType.MCQ,
        text: "Is this alive?",
        icon: '💚',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-alive', text: 'Yes, alive' },
            { id: 'opt-dead', text: 'No, not alive' },
            { id: 'opt-was', text: 'Was alive (organic)' }
        ]
    },
    {
        id: 'mcq-09',
        type: QuestionType.MCQ,
        text: "What temperature is this typically?",
        icon: '🌡️',
        timeLimitSeconds: 20,
        options: [
            { id: 'opt-hot', text: 'Hot' },
            { id: 'opt-warm', text: 'Warm' },
            { id: 'opt-cool', text: 'Cool' },
            { id: 'opt-cold', text: 'Cold' },
            { id: 'opt-room', text: 'Room temperature' },
            { id: 'opt-varies', text: 'Varies' }
        ]
    },
    {
        id: 'mcq-10',
        type: QuestionType.MCQ,
        text: "How much does this typically cost?",
        icon: '💰',
        timeLimitSeconds: 20,
        options: [
            { id: 'opt-free', text: 'Free' },
            { id: 'opt-cheap', text: 'Under $10' },
            { id: 'opt-moderate', text: '$10-$100' },
            { id: 'opt-expensive', text: '$100-$1000' },
            { id: 'opt-very-expensive', text: 'Over $1000' }
        ]
    },
    {
        id: 'mcq-11',
        type: QuestionType.MCQ,
        text: "Which season is this most associated with?",
        icon: '🍂',
        timeLimitSeconds: 20,
        options: [
            { id: 'opt-spring', text: 'Spring' },
            { id: 'opt-summer', text: 'Summer' },
            { id: 'opt-fall', text: 'Fall/Autumn' },
            { id: 'opt-winter', text: 'Winter' },
            { id: 'opt-all-seasons', text: 'All seasons' }
        ]
    },
    {
        id: 'mcq-12',
        type: QuestionType.MCQ,
        text: "Is this common or rare?",
        icon: '🔍',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-very-common', text: 'Very common' },
            { id: 'opt-common', text: 'Common' },
            { id: 'opt-uncommon', text: 'Uncommon' },
            { id: 'opt-rare', text: 'Rare' },
            { id: 'opt-very-rare', text: 'Very rare' }
        ]
    },
    {
        id: 'mcq-13',
        type: QuestionType.MCQ,
        text: "Can this move on its own?",
        icon: '🏃',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-yes-moves', text: 'Yes, moves by itself' },
            { id: 'opt-needs-power', text: 'Needs power/fuel' },
            { id: 'opt-no-move', text: 'No, stationary' }
        ]
    },
    {
        id: 'mcq-14',
        type: QuestionType.MCQ,
        text: "Would you find this indoors or outdoors?",
        icon: '🏠',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-indoors', text: 'Indoors only' },
            { id: 'opt-outdoors', text: 'Outdoors only' },
            { id: 'opt-both-places', text: 'Both' }
        ]
    },
    {
        id: 'mcq-15',
        type: QuestionType.MCQ,
        text: "How long does this typically last?",
        icon: '⏳',
        timeLimitSeconds: 20,
        options: [
            { id: 'opt-minutes', text: 'Minutes' },
            { id: 'opt-hours', text: 'Hours' },
            { id: 'opt-days', text: 'Days/Weeks' },
            { id: 'opt-years', text: 'Years' },
            { id: 'opt-forever', text: 'Indefinitely' }
        ]
    },
    {
        id: 'mcq-16',
        type: QuestionType.MCQ,
        text: "Does this require electricity?",
        icon: '⚡',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-yes-electric', text: 'Yes' },
            { id: 'opt-no-electric', text: 'No' },
            { id: 'opt-optional', text: 'Optional/Sometimes' }
        ]
    },
    {
        id: 'mcq-17',
        type: QuestionType.MCQ,
        text: "What texture does this have?",
        icon: '👆',
        timeLimitSeconds: 20,
        options: [
            { id: 'opt-soft', text: 'Soft' },
            { id: 'opt-hard', text: 'Hard' },
            { id: 'opt-smooth', text: 'Smooth' },
            { id: 'opt-rough', text: 'Rough' },
            { id: 'opt-wet', text: 'Wet/Liquid' },
            { id: 'opt-mixed', text: 'Mixed textures' }
        ]
    },
    {
        id: 'mcq-18',
        type: QuestionType.MCQ,
        text: "Is this heavy or light?",
        icon: '⚖️',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-very-light', text: 'Very light' },
            { id: 'opt-light', text: 'Light' },
            { id: 'opt-medium-weight', text: 'Medium weight' },
            { id: 'opt-heavy', text: 'Heavy' },
            { id: 'opt-very-heavy', text: 'Very heavy' }
        ]
    },
    {
        id: 'mcq-19',
        type: QuestionType.MCQ,
        text: "Is this considered healthy?",
        icon: '❤️',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-very-healthy', text: 'Very healthy' },
            { id: 'opt-healthy', text: 'Healthy' },
            { id: 'opt-neutral', text: 'Neutral' },
            { id: 'opt-unhealthy', text: 'Unhealthy' },
            { id: 'opt-not-applicable', text: 'Not applicable' }
        ]
    },
    {
        id: 'mcq-20',
        type: QuestionType.MCQ,
        text: "Would most people like this?",
        icon: '😊',
        timeLimitSeconds: 15,
        options: [
            { id: 'opt-love', text: 'Most people love it' },
            { id: 'opt-like', text: 'Most people like it' },
            { id: 'opt-mixed-feelings', text: 'Mixed opinions' },
            { id: 'opt-dislike', text: 'Most people dislike it' }
        ]
    },

    // ===== FREE TEXT QUESTIONS (~30%) =====
    {
        id: 'free-01',
        type: QuestionType.FREE_TEXT,
        text: "What's the first thing you think of when you see this?",
        icon: '🧠',
        timeLimitSeconds: 20
    },
    {
        id: 'free-02',
        type: QuestionType.FREE_TEXT,
        text: "Describe this using only 3 words.",
        icon: '✍️',
        timeLimitSeconds: 20
    },
    {
        id: 'free-03',
        type: QuestionType.FREE_TEXT,
        text: "What's a fun memory you have related to this?",
        icon: '😊',
        timeLimitSeconds: 25
    },
    {
        id: 'free-04',
        type: QuestionType.FREE_TEXT,
        text: "If this could talk, what would it say?",
        icon: '💬',
        timeLimitSeconds: 20
    },
    {
        id: 'free-05',
        type: QuestionType.FREE_TEXT,
        text: "What's a funny nickname for this?",
        icon: '😂',
        timeLimitSeconds: 20
    },
    {
        id: 'free-06',
        type: QuestionType.FREE_TEXT,
        text: "What celebrity reminds you of this?",
        icon: '⭐',
        timeLimitSeconds: 20
    },
    {
        id: 'free-07',
        type: QuestionType.FREE_TEXT,
        text: "What song best represents this?",
        icon: '🎵',
        timeLimitSeconds: 20
    },
    {
        id: 'free-08',
        type: QuestionType.FREE_TEXT,
        text: "If this was a superhero, what would its power be?",
        icon: '🦸',
        timeLimitSeconds: 25
    },
    {
        id: 'free-09',
        type: QuestionType.FREE_TEXT,
        text: "What emoji best describes this?",
        icon: '😎',
        timeLimitSeconds: 15
    },
    {
        id: 'free-10',
        type: QuestionType.FREE_TEXT,
        text: "How would you describe this to an alien?",
        icon: '👽',
        timeLimitSeconds: 25
    }
];

// ============================================
// ITEM MANAGER CLASS
// ============================================

class ItemManager {
    constructor() {
        this.usedItemIds = new Set();
        this.items = [...ITEM_DATABASE];
        this.questions = [...QUESTION_BANK];
        this.mcqQuestions = this.questions.filter(q => q.type === QuestionType.MCQ);
        this.freeTextQuestions = this.questions.filter(q => q.type === QuestionType.FREE_TEXT);
    }

    /**
     * Get a random item that hasn't been used recently
     * @returns {Object} Item object
     */
    getRandomItem() {
        // Reset if we've used most items
        if (this.usedItemIds.size >= this.items.length * 0.8) {
            this.usedItemIds.clear();
        }

        // Filter available items
        const availableItems = this.items.filter(item => !this.usedItemIds.has(item.id));

        if (availableItems.length === 0) {
            this.usedItemIds.clear();
            return this.items[Math.floor(Math.random() * this.items.length)];
        }

        const item = availableItems[Math.floor(Math.random() * availableItems.length)];
        this.usedItemIds.add(item.id);
        return item;
    }

    /**
     * Get shuffled questions for a round with proper MCQ/FREE_TEXT ratio
     * Recommended: ~70% MCQ, ~30% FREE_TEXT
     * @param {number} count - Total number of questions
     * @returns {Array} Array of question objects
     */
    getShuffledQuestions(count = 10) {
        const mcqCount = Math.ceil(count * 0.7); // 70% MCQ
        const freeTextCount = count - mcqCount;  // 30% FREE_TEXT

        // Get random MCQ questions
        const shuffledMcq = [...this.mcqQuestions].sort(() => Math.random() - 0.5);
        const selectedMcq = shuffledMcq.slice(0, mcqCount);

        // Get random FREE_TEXT questions
        const shuffledFreeText = [...this.freeTextQuestions].sort(() => Math.random() - 0.5);
        const selectedFreeText = shuffledFreeText.slice(0, freeTextCount);

        // Combine and shuffle
        const combined = [...selectedMcq, ...selectedFreeText];
        return combined.sort(() => Math.random() - 0.5);
    }

    /**
     * Validate MCQ answer for a non-liar player
     * @param {Object} question - The question object
     * @param {Object} item - The secret item
     * @param {string} selectedOptionId - The option ID selected by player
     * @returns {boolean} True if answer is valid/correct
     */
    validateMcqAnswer(question, item, selectedOptionId) {
        if (question.type !== QuestionType.MCQ) {
            return true; // FREE_TEXT questions are always "valid"
        }

        // Dynamic validation based on question and item
        switch (question.id) {
            case 'mcq-01': // Category question
                return this.validateCategory(item, selectedOptionId);
            case 'mcq-05': // Can you eat/drink?
                return this.validateEdibility(item, selectedOptionId);
            case 'mcq-06': // Natural or man-made?
                return this.validateOrigin(item, selectedOptionId);
            case 'mcq-08': // Is this alive?
                return this.validateAlive(item, selectedOptionId);
            // Add more specific validations as needed
            default:
                // For questions without strict validation, accept any answer
                return true;
        }
    }

    validateCategory(item, selectedOptionId) {
        const categoryMap = {
            'Food': 'opt-food',
            'Dessert': 'opt-food',
            'Beverage': 'opt-food',
            'Snack': 'opt-food',
            'Animal': 'opt-animal',
            'Object': 'opt-object',
            'Tool': 'opt-object',
            'Place': 'opt-place',
            'Sport': 'opt-activity',
            'Activity': 'opt-activity',
            'Weather': 'opt-nature',
            'Nature': 'opt-nature',
            'Space': 'opt-nature',
            'Technology': 'opt-tech',
            'Vehicle': 'opt-vehicle'
        };
        return categoryMap[item.category] === selectedOptionId;
    }

    validateEdibility(item, selectedOptionId) {
        const edibleCategories = ['Food', 'Dessert', 'Snack'];
        const drinkableCategories = ['Beverage'];

        if (edibleCategories.includes(item.category)) {
            return selectedOptionId === 'opt-yes-eat';
        } else if (drinkableCategories.includes(item.category)) {
            return selectedOptionId === 'opt-yes-drink';
        } else {
            return selectedOptionId === 'opt-no';
        }
    }

    validateOrigin(item, selectedOptionId) {
        const naturalCategories = ['Animal', 'Nature', 'Weather', 'Space'];
        const manMadeCategories = ['Technology', 'Vehicle', 'Food', 'Dessert', 'Beverage'];

        if (naturalCategories.includes(item.category)) {
            return selectedOptionId === 'opt-natural';
        } else if (manMadeCategories.includes(item.category)) {
            return selectedOptionId === 'opt-manmade';
        } else {
            return selectedOptionId === 'opt-both';
        }
    }

    validateAlive(item, selectedOptionId) {
        if (item.category === 'Animal') {
            return selectedOptionId === 'opt-alive';
        } else if (['Food', 'Dessert'].includes(item.category)) {
            return selectedOptionId === 'opt-was';
        } else {
            return selectedOptionId === 'opt-dead';
        }
    }

    /**
     * Get item info for non-liar (full info)
     * @param {Object} item - The item
     * @returns {Object} Info to send to non-liar
     */
    getNonLiarInfo(item) {
        return {
            name: item.name,
            imageUrl: item.imageUrl,
            category: item.category
        };
    }

    /**
     * Get item info for liar (hints only, no name/image)
     * @param {Object} item - The item
     * @returns {Object} Info to send to liar
     */
    getLiarInfo(item) {
        // Give liar 2-4 random hints
        const hintCount = Math.floor(Math.random() * 3) + 2; // 2-4 hints
        const shuffledHints = [...item.hints].sort(() => Math.random() - 0.5);
        return {
            category: item.category,
            hints: shuffledHints.slice(0, hintCount)
        };
    }

    /**
     * Get total item count
     */
    getItemCount() {
        return this.items.length;
    }

    /**
     * Get total question count
     */
    getQuestionCount() {
        return this.questions.length;
    }

    /**
     * Get MCQ count
     */
    getMcqCount() {
        return this.mcqQuestions.length;
    }

    /**
     * Get FREE_TEXT count
     */
    getFreeTextCount() {
        return this.freeTextQuestions.length;
    }

    /**
     * Reset used items
     */
    reset() {
        this.usedItemIds.clear();
    }
}

// Export for use in main game
window.ItemManager = ItemManager;
window.ITEM_DATABASE = ITEM_DATABASE;
window.QUESTION_BANK = QUESTION_BANK;
window.QuestionType = QuestionType;

