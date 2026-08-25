/**
 * Language and direction for SponsorPulse.
 *
 * The audience for a sponsored event in this region is often reading Arabic or
 * Hebrew, so right-to-left is a first-class layout here rather than a later
 * retrofit: setting the language sets `dir` on the document, and the CSS is
 * written with logical properties so nothing needs mirroring by hand.
 */
(function (window) {
    'use strict';

    var STRINGS = {
        en: {
            dir: 'ltr', name: 'English',
            join: 'Join', joining: 'Joining…', yourName: 'Your name',
            enterName: 'Enter your name to join',
            waiting: 'Waiting for the host to start something',
            poll: 'Poll', quiz: 'Quiz', qa: 'Questions', leaderboard: 'Leaderboard',
            vote: 'Vote', voted: 'Your answer is in', submit: 'Submit',
            askQuestion: 'Ask a question', askPlaceholder: 'What would you like to ask?',
            upvote: 'Upvote', pinned: 'Pinned', timeLeft: 'Time left',
            correct: 'Correct', wrong: 'Not this time', points: 'points',
            consentLabel: 'Keep me posted about this event and offers from the sponsor',
            privacy: 'Your name is shown to the room. Contact details are shared with the '
                   + 'organiser only if you tick the box above, and are deleted after the event.',
            optionalEmail: 'Email (optional)',
            thanks: 'Thanks for taking part', roomFull: 'This event is full',
            connectionLost: 'Connection lost — reconnecting…',
            sponsoredBy: 'Sponsored by', claimOffer: 'Claim offer'
        },
        ar: {
            dir: 'rtl', name: 'العربية',
            join: 'انضمام', joining: 'جارٍ الانضمام…', yourName: 'اسمك',
            enterName: 'أدخل اسمك للانضمام',
            waiting: 'في انتظار أن يبدأ المنظم',
            poll: 'استطلاع', quiz: 'مسابقة', qa: 'الأسئلة', leaderboard: 'المتصدرون',
            vote: 'تصويت', voted: 'تم تسجيل إجابتك', submit: 'إرسال',
            askQuestion: 'اطرح سؤالاً', askPlaceholder: 'ما الذي تود أن تسأل عنه؟',
            upvote: 'تأييد', pinned: 'مثبّت', timeLeft: 'الوقت المتبقي',
            correct: 'إجابة صحيحة', wrong: 'ليست هذه المرة', points: 'نقطة',
            consentLabel: 'أرغب في تلقي أخبار هذه الفعالية وعروض الراعي',
            privacy: 'يظهر اسمك للحاضرين. لا تُشارك بيانات الاتصال مع المنظم إلا إذا '
                   + 'اخترت ذلك أعلاه، وتُحذف بعد انتهاء الفعالية.',
            optionalEmail: 'البريد الإلكتروني (اختياري)',
            thanks: 'شكراً لمشاركتك', roomFull: 'اكتمل عدد الحاضرين',
            connectionLost: 'انقطع الاتصال — تتم إعادة المحاولة…',
            sponsoredBy: 'برعاية', claimOffer: 'احصل على العرض'
        },
        he: {
            dir: 'rtl', name: 'עברית',
            join: 'הצטרפות', joining: 'מצטרף…', yourName: 'השם שלך',
            enterName: 'הזינו שם כדי להצטרף',
            waiting: 'ממתינים שהמנחה יתחיל',
            poll: 'סקר', quiz: 'חידון', qa: 'שאלות', leaderboard: 'טבלת מובילים',
            vote: 'הצבעה', voted: 'התשובה נקלטה', submit: 'שליחה',
            askQuestion: 'שאלו שאלה', askPlaceholder: 'מה תרצו לשאול?',
            upvote: 'חיזוק', pinned: 'נעוץ', timeLeft: 'זמן שנותר',
            correct: 'נכון', wrong: 'לא הפעם', points: 'נקודות',
            consentLabel: 'אשמח לקבל עדכונים על האירוע והצעות מהספונסר',
            privacy: 'השם שלכם מוצג למשתתפים. פרטי הקשר יימסרו למארגן רק אם סימנתם '
                   + 'למעלה, ויימחקו בתום האירוע.',
            optionalEmail: 'אימייל (לא חובה)',
            thanks: 'תודה שהשתתפתם', roomFull: 'האירוע מלא',
            connectionLost: 'החיבור נותק — מתחבר מחדש…',
            sponsoredBy: 'בחסות', claimOffer: 'למימוש ההטבה'
        }
    };

    var current = 'en';

    function setLanguage(code) {
        if (!STRINGS[code]) return false;
        current = code;
        var strings = STRINGS[code];
        document.documentElement.setAttribute('lang', code);
        document.documentElement.setAttribute('dir', strings.dir);
        applyToDocument();
        return true;
    }

    function t(key) {
        var strings = STRINGS[current] || STRINGS.en;
        // Fall back to English rather than showing a raw key to an attendee.
        return strings[key] !== undefined ? strings[key] : (STRINGS.en[key] || key);
    }

    /** Fill every [data-i18n] element and [data-i18n-ph] placeholder. */
    function applyToDocument() {
        document.querySelectorAll('[data-i18n]').forEach(function (el) {
            el.textContent = t(el.getAttribute('data-i18n'));
        });
        document.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
            el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
        });
    }

    function languages() {
        return Object.keys(STRINGS).map(function (code) {
            return { code: code, name: STRINGS[code].name, dir: STRINGS[code].dir };
        });
    }

    function direction() {
        return (STRINGS[current] || STRINGS.en).dir;
    }

    window.SponsorPulseI18n = {
        setLanguage: setLanguage,
        t: t,
        apply: applyToDocument,
        languages: languages,
        direction: direction,
        get current() { return current; }
    };
})(window);
