const path = require('path');
const fs = require('fs');

const TEST_DATA_FILE = path.join(__dirname, 'test-data.json');

const getTestApp = () => {
    process.env.DATA_FILE = TEST_DATA_FILE;
    delete require.cache[require.resolve('../server')];
    const { app } = require('../server');
    return app;
};

const createTestDeck = async (request, name = '测试卡片组', description = '测试描述') => {
    const response = await request.post('/api/decks').send({ name, description });
    return response.body;
};

const createTestCard = async (request, deckId, front = '问题', back = '答案') => {
    const response = await request.post(`/api/decks/${deckId}/cards`).send({ front, back });
    return response.body;
};

const createMultipleCards = async (request, deckId, count) => {
    const cards = [];
    for (let i = 0; i < count; i++) {
        const card = await createTestCard(request, deckId, `问题 ${i + 1}`, `答案 ${i + 1}`);
        cards.push(card);
    }
    return cards;
};

const createCardsWithDueDates = async (request, deckId, dates) => {
    const cards = [];
    for (let i = 0; i < dates.length; i++) {
        const card = await createTestCard(request, deckId, `问题 ${i + 1}`, `答案 ${i + 1}`);
        card.next_review = dates[i];
        cards.push(card);
    }
    return cards;
};

const formatDate = (date) => {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const addDays = (dateStr, days) => {
    const date = new Date(dateStr + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return formatDate(date);
};

const getTodayUTC = () => {
    const now = new Date();
    return formatDate(now);
};

module.exports = {
    TEST_DATA_FILE,
    getTestApp,
    createTestDeck,
    createTestCard,
    createMultipleCards,
    createCardsWithDueDates,
    formatDate,
    addDays,
    getTodayUTC
};
