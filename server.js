const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const DATA_FILE = process.env.DATA_FILE || 'data.json';

const loadData = () => {
    if (!fs.existsSync(DATA_FILE)) {
        return { decks: [], cards: [], reviewLogs: [], sharedDecks: [], examSessions: [] };
    }
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (!data.sharedDecks) data.sharedDecks = [];
        if (!data.examSessions) data.examSessions = [];
        return data;
    } catch (e) {
        return { decks: [], cards: [], reviewLogs: [], sharedDecks: [], examSessions: [] };
    }
};

const saveData = (data) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

const calculateNextReview = (card, quality, referenceDate = null) => {
    let { easiness, interval, repetitions } = card;
    const today = referenceDate || getUTCToday();

    if (quality >= 3) {
        if (repetitions === 0) {
            interval = 1;
        } else if (repetitions === 1) {
            interval = 6;
        } else {
            interval = Math.round(interval * easiness);
        }
        repetitions++;
    } else {
        repetitions = 0;
        interval = 1;
    }

    easiness = easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (easiness < 1.3) easiness = 1.3;

    const nextReview = addDaysToDate(today, interval);

    return {
        easiness: parseFloat(easiness.toFixed(2)),
        interval,
        repetitions,
        next_review: nextReview
    };
};

const getUTCToday = () => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
};

const getLocalToday = (timezoneOffset = 0) => {
    const now = new Date();
    const localTime = new Date(now.getTime() - timezoneOffset * 60000);
    return `${localTime.getUTCFullYear()}-${String(localTime.getUTCMonth() + 1).padStart(2, '0')}-${String(localTime.getUTCDate()).padStart(2, '0')}`;
};

const parseDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
};

const addDaysToDate = (dateStr, days) => {
    const date = parseDate(dateStr);
    date.setUTCDate(date.getUTCDate() + days);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const compareDates = (dateStr1, dateStr2) => {
    return dateStr1.localeCompare(dateStr2);
};

const isDateDue = (nextReviewDate, referenceDate) => {
    return compareDates(nextReviewDate, referenceDate) <= 0;
};

// Deck APIs
app.get('/api/decks', (req, res) => {
    const data = loadData();
    const timezoneOffset = parseInt(req.query.timezone_offset) || 0;
    const today = timezoneOffset !== 0 ? getLocalToday(timezoneOffset) : getUTCToday();
    
    const decksWithStats = data.decks.map(deck => {
        const deckCards = data.cards.filter(c => c.deck_id === deck.id);
        const dueCount = deckCards.filter(c => isDateDue(c.next_review, today)).length;
        return {
            ...deck,
            card_count: deckCards.length,
            due_count: dueCount
        };
    });
    res.json(decksWithStats);
});

app.post('/api/decks', (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Deck name is required' });
    
    const data = loadData();
    const newDeck = {
        id: data.decks.length > 0 ? Math.max(...data.decks.map(d => d.id)) + 1 : 1,
        name,
        description: description || '',
        created_at: new Date().toISOString(),
        version: 1,
        last_modified: new Date().toISOString()
    };
    
    data.decks.push(newDeck);
    saveData(data);
    res.status(201).json(newDeck);
});

app.put('/api/decks/:id', (req, res) => {
    const { name, description, expected_version } = req.body;
    const data = loadData();
    const deckIndex = data.decks.findIndex(d => d.id === parseInt(req.params.id));
    
    if (deckIndex === -1) return res.status(404).json({ error: 'Deck not found' });
    
    const deck = data.decks[deckIndex];
    
    if (expected_version !== undefined && deck.version !== undefined && deck.version !== expected_version) {
        return res.status(409).json({ 
            error: 'Conflict: Deck has been modified by another user',
            current_version: deck.version,
            expected_version: expected_version,
            current_deck: deck
        });
    }
    
    const newVersion = (deck.version || 1) + 1;
    data.decks[deckIndex] = {
        ...deck,
        name,
        description: description || '',
        version: newVersion,
        last_modified: new Date().toISOString()
    };
    saveData(data);
    res.json(data.decks[deckIndex]);
});

app.delete('/api/decks/:id', (req, res) => {
    const data = loadData();
    const deckId = parseInt(req.params.id);
    
    const deckIndex = data.decks.findIndex(d => d.id === deckId);
    if (deckIndex === -1) return res.status(404).json({ error: 'Deck not found' });
    
    data.decks.splice(deckIndex, 1);
    data.cards = data.cards.filter(c => c.deck_id !== deckId);
    const cardIds = data.cards.filter(c => c.deck_id !== deckId).map(c => c.id);
    data.reviewLogs = data.reviewLogs.filter(r => cardIds.includes(r.card_id));
    
    saveData(data);
    res.json({ success: true });
});

// Card APIs
app.get('/api/decks/:deckId/cards', (req, res) => {
    const data = loadData();
    const cards = data.cards.filter(c => c.deck_id === parseInt(req.params.deckId))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(cards);
});

app.post('/api/decks/:deckId/cards', (req, res) => {
    const { front, back } = req.body;
    if (!front || !back) return res.status(400).json({ error: 'Front and back are required' });
    
    const data = loadData();
    const today = getUTCToday();
    const newCard = {
        id: data.cards.length > 0 ? Math.max(...data.cards.map(c => c.id)) + 1 : 1,
        deck_id: parseInt(req.params.deckId),
        front,
        back,
        easiness: 2.5,
        interval: 1,
        repetitions: 0,
        next_review: today,
        created_at: new Date().toISOString(),
        version: 1,
        last_modified: new Date().toISOString()
    };
    
    data.cards.push(newCard);
    saveData(data);
    res.status(201).json(newCard);
});

app.put('/api/cards/:id', (req, res) => {
    const { front, back, expected_version } = req.body;
    const data = loadData();
    const cardIndex = data.cards.findIndex(c => c.id === parseInt(req.params.id));
    
    if (cardIndex === -1) return res.status(404).json({ error: 'Card not found' });
    
    const card = data.cards[cardIndex];
    
    if (expected_version !== undefined && card.version !== undefined && card.version !== expected_version) {
        return res.status(409).json({ 
            error: 'Conflict: Card has been modified by another user',
            current_version: card.version,
            expected_version: expected_version,
            current_card: card
        });
    }
    
    const newVersion = (card.version || 1) + 1;
    data.cards[cardIndex] = {
        ...card,
        front,
        back,
        version: newVersion,
        last_modified: new Date().toISOString()
    };
    saveData(data);
    res.json(data.cards[cardIndex]);
});

app.delete('/api/cards/:id', (req, res) => {
    const data = loadData();
    const cardId = parseInt(req.params.id);
    
    const cardIndex = data.cards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return res.status(404).json({ error: 'Card not found' });
    
    data.cards.splice(cardIndex, 1);
    data.reviewLogs = data.reviewLogs.filter(r => r.card_id !== cardId);
    
    saveData(data);
    res.json({ success: true });
});

// Review APIs
app.get('/api/review/due', (req, res) => {
    const { deckId, timezone_offset, limit, offset } = req.query;
    const data = loadData();
    const timezoneOffset = parseInt(timezone_offset) || 0;
    const today = timezoneOffset !== 0 ? getLocalToday(timezoneOffset) : getUTCToday();
    
    let cards = data.cards.filter(c => isDateDue(c.next_review, today));
    if (deckId) {
        cards = cards.filter(c => c.deck_id === parseInt(deckId));
    }
    
    cards.sort((a, b) => compareDates(a.next_review, b.next_review));
    
    if (limit) {
        const pageLimit = parseInt(limit);
        const pageOffset = parseInt(offset) || 0;
        const paginatedCards = cards.slice(pageOffset, pageOffset + pageLimit);
        res.json({
            cards: paginatedCards,
            total: cards.length,
            hasMore: pageOffset + pageLimit < cards.length,
            offset: pageOffset,
            limit: pageLimit
        });
    } else {
        res.json(cards);
    }
});

app.post('/api/review/:cardId', (req, res) => {
    const { quality, timezone_offset, expected_version } = req.body;
    if (quality < 0 || quality > 5) return res.status(400).json({ error: 'Quality must be between 0 and 5' });
    
    const timezoneOffset = parseInt(timezone_offset) || 0;
    const today = timezoneOffset !== 0 ? getLocalToday(timezoneOffset) : getUTCToday();
    
    const data = loadData();
    const cardIndex = data.cards.findIndex(c => c.id === parseInt(req.params.cardId));
    
    if (cardIndex === -1) return res.status(404).json({ error: 'Card not found' });
    
    const card = data.cards[cardIndex];
    
    if (expected_version !== undefined && card.version !== undefined && card.version !== expected_version) {
        return res.status(409).json({ 
            error: 'Conflict: Card has been modified by another user',
            current_version: card.version,
            expected_version: expected_version
        });
    }
    
    const previousEasiness = card.easiness;
    const previousInterval = card.interval;
    
    const updates = calculateNextReview(card, quality, today);
    const newVersion = (card.version || 1) + 1;
    
    data.cards[cardIndex] = {
        ...card,
        ...updates,
        version: newVersion,
        last_modified: new Date().toISOString()
    };
    
    const newLog = {
        id: data.reviewLogs.length > 0 ? Math.max(...data.reviewLogs.map(r => r.id)) + 1 : 1,
        card_id: card.id,
        quality,
        previous_easiness: previousEasiness,
        previous_interval: previousInterval,
        new_easiness: updates.easiness,
        new_interval: updates.interval,
        reviewed_at: new Date().toISOString()
    };
    data.reviewLogs.push(newLog);
    
    saveData(data);
    res.json(data.cards[cardIndex]);
});

app.get('/api/stats', (req, res) => {
    const data = loadData();
    const timezoneOffset = parseInt(req.query.timezone_offset) || 0;
    const today = timezoneOffset !== 0 ? getLocalToday(timezoneOffset) : getUTCToday();
    
    res.json({
        totalCards: data.cards.length,
        totalDecks: data.decks.length,
        dueToday: data.cards.filter(c => isDateDue(c.next_review, today)).length,
        totalReviews: data.reviewLogs.length,
        totalSharedDecks: data.sharedDecks.length,
        totalExams: data.examSessions.length
    });
});

// Shared Decks APIs
app.post('/api/decks/:id/share', (req, res) => {
    const { title, description, tags, author } = req.body;
    const data = loadData();
    const deckId = parseInt(req.params.id);
    
    const deck = data.decks.find(d => d.id === deckId);
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    
    const deckCards = data.cards.filter(c => c.deck_id === deckId);
    
    const newSharedDeck = {
        id: data.sharedDecks.length > 0 ? Math.max(...data.sharedDecks.map(d => d.id)) + 1 : 1,
        original_deck_id: deckId,
        title: title || deck.name,
        description: description || deck.description,
        tags: tags || [],
        author: author || '匿名用户',
        card_count: deckCards.length,
        cards: deckCards.map(c => ({
            front: c.front,
            back: c.back
        })),
        created_at: new Date().toISOString(),
        views: 0,
        likes: 0
    };
    
    data.sharedDecks.push(newSharedDeck);
    saveData(data);
    res.status(201).json(newSharedDeck);
});

app.get('/api/shared-decks', (req, res) => {
    const { search, tag, sort, limit, offset } = req.query;
    let data = loadData();
    let sharedDecks = [...data.sharedDecks];
    
    if (search) {
        const searchLower = search.toLowerCase();
        sharedDecks = sharedDecks.filter(deck => 
            deck.title.toLowerCase().includes(searchLower) ||
            deck.description.toLowerCase().includes(searchLower)
        );
    }
    
    if (tag) {
        sharedDecks = sharedDecks.filter(deck => 
            deck.tags && deck.tags.includes(tag)
        );
    }
    
    if (sort === 'popular') {
        sharedDecks.sort((a, b) => b.likes - a.likes);
    } else if (sort === 'recent') {
        sharedDecks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } else if (sort === 'views') {
        sharedDecks.sort((a, b) => b.views - a.views);
    } else {
        sharedDecks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    
    if (limit) {
        const pageLimit = parseInt(limit);
        const pageOffset = parseInt(offset) || 0;
        const paginatedDecks = sharedDecks.slice(pageOffset, pageOffset + pageLimit);
        res.json({
            decks: paginatedDecks,
            total: sharedDecks.length,
            hasMore: pageOffset + pageLimit < sharedDecks.length
        });
    } else {
        res.json(sharedDecks);
    }
});

app.get('/api/shared-decks/:id', (req, res) => {
    const data = loadData();
    const sharedDeck = data.sharedDecks.find(d => d.id === parseInt(req.params.id));
    
    if (!sharedDeck) return res.status(404).json({ error: 'Shared deck not found' });
    
    sharedDeck.views++;
    saveData(data);
    res.json(sharedDeck);
});

app.post('/api/shared-decks/:id/like', (req, res) => {
    const data = loadData();
    const sharedDeck = data.sharedDecks.find(d => d.id === parseInt(req.params.id));
    
    if (!sharedDeck) return res.status(404).json({ error: 'Shared deck not found' });
    
    sharedDeck.likes++;
    saveData(data);
    res.json({ success: true, likes: sharedDeck.likes });
});

app.post('/api/shared-decks/:id/import', (req, res) => {
    const data = loadData();
    const sharedDeck = data.sharedDecks.find(d => d.id === parseInt(req.params.id));
    
    if (!sharedDeck) return res.status(404).json({ error: 'Shared deck not found' });
    
    const newDeck = {
        id: data.decks.length > 0 ? Math.max(...data.decks.map(d => d.id)) + 1 : 1,
        name: sharedDeck.title,
        description: sharedDeck.description,
        imported_from: sharedDeck.id,
        created_at: new Date().toISOString(),
        version: 1,
        last_modified: new Date().toISOString()
    };
    
    data.decks.push(newDeck);
    
    const today = getUTCToday();
    sharedDeck.cards.forEach(card => {
        const newCard = {
            id: data.cards.length > 0 ? Math.max(...data.cards.map(c => c.id)) + 1 : 1,
            deck_id: newDeck.id,
            front: card.front,
            back: card.back,
            easiness: 2.5,
            interval: 1,
            repetitions: 0,
            next_review: today,
            created_at: new Date().toISOString(),
            version: 1,
            last_modified: new Date().toISOString()
        };
        data.cards.push(newCard);
    });
    
    saveData(data);
    res.status(201).json({ deck: newDeck, cardCount: sharedDeck.cards.length });
});

app.delete('/api/shared-decks/:id', (req, res) => {
    const data = loadData();
    const deckIndex = data.sharedDecks.findIndex(d => d.id === parseInt(req.params.id));
    
    if (deckIndex === -1) return res.status(404).json({ error: 'Shared deck not found' });
    
    data.sharedDecks.splice(deckIndex, 1);
    saveData(data);
    res.json({ success: true });
});

// Exam Mode APIs
app.post('/api/exams/create', (req, res) => {
    const { deckId, cardCount, timeLimit, title } = req.body;
    const data = loadData();
    
    let examCards = [];
    if (deckId) {
        examCards = data.cards.filter(c => c.deck_id === parseInt(deckId));
    } else {
        examCards = data.cards;
    }
    
    const count = cardCount ? Math.min(parseInt(cardCount), examCards.length) : examCards.length;
    const shuffled = [...examCards].sort(() => Math.random() - 0.5);
    const selectedCards = shuffled.slice(0, count);
    
    const newExam = {
        id: data.examSessions.length > 0 ? Math.max(...data.examSessions.map(e => e.id)) + 1 : 1,
        title: title || '模拟考试',
        deck_id: deckId ? parseInt(deckId) : null,
        total_cards: selectedCards.length,
        time_limit: timeLimit ? parseInt(timeLimit) : 0,
        cards: selectedCards.map(c => ({
            card_id: c.id,
            front: c.front,
            back: c.back
        })),
        created_at: new Date().toISOString(),
        status: 'pending'
    };
    
    data.examSessions.push(newExam);
    saveData(data);
    res.status(201).json(newExam);
});

app.post('/api/exams/:id/start', (req, res) => {
    const data = loadData();
    const exam = data.examSessions.find(e => e.id === parseInt(req.params.id));
    
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (exam.status !== 'pending') return res.status(400).json({ error: 'Exam already started or completed' });
    
    exam.status = 'in_progress';
    exam.started_at = new Date().toISOString();
    exam.end_time = exam.time_limit > 0 
        ? new Date(new Date().getTime() + exam.time_limit * 60000).toISOString()
        : null;
    
    saveData(data);
    res.json({
        exam: exam,
        cards: exam.cards.map(c => ({ id: c.card_id, front: c.front }))
    });
});

app.post('/api/exams/:id/submit', (req, res) => {
    const { answers } = req.body;
    const data = loadData();
    const exam = data.examSessions.find(e => e.id === parseInt(req.params.id));
    
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    
    exam.status = 'completed';
    exam.completed_at = new Date().toISOString();
    exam.answers = answers || {};
    
    let correctCount = 0;
    const results = exam.cards.map(card => {
        const userAnswer = answers[card.card_id] || '';
        const isCorrect = userAnswer.toLowerCase().trim() === card.back.toLowerCase().trim();
        if (isCorrect) correctCount++;
        return {
            card_id: card.card_id,
            front: card.front,
            correct_answer: card.back,
            user_answer: userAnswer,
            is_correct: isCorrect
        };
    });
    
    exam.score = Math.round((correctCount / exam.total_cards) * 100);
    exam.correct_count = correctCount;
    exam.results = results;
    
    saveData(data);
    res.json({
        exam: exam,
        score: exam.score,
        correct_count: correctCount,
        total_cards: exam.total_cards,
        results: results
    });
});

app.get('/api/exams/:id/results', (req, res) => {
    const data = loadData();
    const exam = data.examSessions.find(e => e.id === parseInt(req.params.id));
    
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    if (exam.status !== 'completed') return res.status(400).json({ error: 'Exam not completed yet' });
    
    res.json(exam);
});

app.get('/api/exams', (req, res) => {
    const data = loadData();
    const exams = data.examSessions
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 50);
    
    res.json(exams.map(e => ({
        id: e.id,
        title: e.title,
        total_cards: e.total_cards,
        time_limit: e.time_limit,
        status: e.status,
        score: e.score,
        created_at: e.created_at,
        completed_at: e.completed_at
    })));
});

app.delete('/api/exams/:id', (req, res) => {
    const data = loadData();
    const examIndex = data.examSessions.findIndex(e => e.id === parseInt(req.params.id));
    
    if (examIndex === -1) return res.status(404).json({ error: 'Exam not found' });
    
    data.examSessions.splice(examIndex, 1);
    saveData(data);
    res.json({ success: true });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const startServer = (port = PORT) => {
    return app.listen(port, () => {
        console.log(`Server running on http://localhost:${port}`);
    });
};

if (require.main === module) {
    startServer();
}

module.exports = { 
    app, 
    startServer, 
    calculateNextReview, 
    getUTCToday, 
    getLocalToday,
    addDaysToDate,
    isDateDue
};
