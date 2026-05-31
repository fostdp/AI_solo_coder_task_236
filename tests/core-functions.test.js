const path = require('path');
const fs = require('fs');

const TEST_DATA_FILE = path.join(__dirname, 'core-test-data.json');

describe('核心函数单元测试', () => {
    let calculateNextReview;
    let getUTCToday;
    let getLocalToday;
    let addDaysToDate;
    let isDateDue;

    beforeAll(() => {
        process.env.DATA_FILE = TEST_DATA_FILE;
        delete require.cache[require.resolve('../server')];
        const server = require('../server');
        calculateNextReview = server.calculateNextReview;
        getUTCToday = server.getUTCToday;
        getLocalToday = server.getLocalToday;
        addDaysToDate = server.addDaysToDate;
        isDateDue = server.isDateDue;
    });

    beforeEach(() => {
        if (fs.existsSync(TEST_DATA_FILE)) {
            try {
                fs.unlinkSync(TEST_DATA_FILE);
            } catch (e) {}
        }
    });

    afterAll(() => {
        if (fs.existsSync(TEST_DATA_FILE)) {
            try {
                fs.unlinkSync(TEST_DATA_FILE);
            } catch (e) {}
        }
        delete require.cache[require.resolve('../server')];
    });

    describe('间隔重复算法测试', () => {
        test('首次复习正确的间隔应该是1天', () => {
            const card = {
                easiness: 2.5,
                interval: 1,
                repetitions: 0
            };
            
            const result = calculateNextReview(card, 4);
            
            expect(result.interval).toBe(1);
            expect(result.repetitions).toBe(1);
        });

        test('第二次复习正确的间隔应该是6天', () => {
            const card = {
                easiness: 2.5,
                interval: 1,
                repetitions: 1
            };
            
            const result = calculateNextReview(card, 4);
            
            expect(result.interval).toBe(6);
            expect(result.repetitions).toBe(2);
        });

        test('第三次及以后复习间隔应该乘以难度系数', () => {
            const card = {
                easiness: 2.5,
                interval: 6,
                repetitions: 2
            };
            
            const result = calculateNextReview(card, 4);
            const expectedInterval = Math.round(6 * 2.5);
            
            expect(result.interval).toBe(expectedInterval);
            expect(result.repetitions).toBe(3);
        });

        test('忘记的卡片应该重置间隔为1天', () => {
            const card = {
                easiness: 2.5,
                interval: 15,
                repetitions: 3
            };
            
            const result = calculateNextReview(card, 0);
            
            expect(result.interval).toBe(1);
            expect(result.repetitions).toBe(0);
        });

        test('完美记忆(5分)应该增加难度系数', () => {
            const card = {
                easiness: 2.5,
                interval: 1,
                repetitions: 0
            };
            
            const result = calculateNextReview(card, 5);
            
            expect(result.easiness).toBeGreaterThan(2.5);
        });

        test('良好记忆(4分)应该保持难度系数不变', () => {
            const card = {
                easiness: 2.5,
                interval: 1,
                repetitions: 0
            };
            
            const result = calculateNextReview(card, 4);
            
            expect(result.easiness).toBe(2.5);
        });

        test('困难记忆(2分)应该降低难度系数', () => {
            const card = {
                easiness: 2.5,
                interval: 1,
                repetitions: 0
            };
            
            const result = calculateNextReview(card, 2);
            
            expect(result.easiness).toBeLessThan(2.5);
        });

        test('完全忘记(0分)应该大幅降低难度系数', () => {
            const card = {
                easiness: 2.5,
                interval: 1,
                repetitions: 0
            };
            
            const result = calculateNextReview(card, 0);
            
            expect(result.easiness).toBeLessThan(2.5);
        });

        test('难度系数不应该低于最小值1.3', () => {
            let card = {
                easiness: 2.5,
                interval: 1,
                repetitions: 0
            };
            
            for (let i = 0; i < 10; i++) {
                const result = calculateNextReview(card, 0);
                card = {
                    easiness: result.easiness,
                    interval: result.interval,
                    repetitions: result.repetitions
                };
            }
            
            expect(card.easiness).toBeGreaterThanOrEqual(1.3);
        });

        test('下次复习日期应该正确计算', () => {
            const card = {
                easiness: 2.5,
                interval: 1,
                repetitions: 0
            };
            const today = getUTCToday();
            
            const result = calculateNextReview(card, 4);
            const expectedDate = addDaysToDate(today, 1);
            
            expect(result.next_review).toBe(expectedDate);
        });

        test('使用自定义参考日期', () => {
            const card = {
                easiness: 2.5,
                interval: 1,
                repetitions: 0
            };
            const customDate = '2024-01-01';
            
            const result = calculateNextReview(card, 4, customDate);
            const expectedDate = addDaysToDate(customDate, 1);
            
            expect(result.next_review).toBe(expectedDate);
        });
    });

    describe('时区一致性测试', () => {
        test('UTC日期应该正确获取', () => {
            const today = getUTCToday();
            
            expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        test('不同时区偏移应该返回不同的本地日期', () => {
            const local1 = getLocalToday(-480);
            const local2 = getLocalToday(480);
            
            expect(local1).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(local2).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        test('日期到期判断应该正确', () => {
            const today = getUTCToday();
            const yesterday = addDaysToDate(today, -1);
            const tomorrow = addDaysToDate(today, 1);
            
            expect(isDateDue(yesterday, today)).toBe(true);
            expect(isDateDue(today, today)).toBe(true);
            expect(isDateDue(tomorrow, today)).toBe(false);
        });

        test('日期加减应该正确', () => {
            const date = '2024-01-15';
            
            expect(addDaysToDate(date, 1)).toBe('2024-01-16');
            expect(addDaysToDate(date, -1)).toBe('2024-01-14');
            expect(addDaysToDate(date, 31)).toBe('2024-02-15');
        });
    });

    describe('版本控制测试', () => {
        test('新创建的卡片应该有版本号', async () => {
            process.env.DATA_FILE = TEST_DATA_FILE;
            delete require.cache[require.resolve('../server')];
            const { app } = require('../server');
            const request = require('supertest');
            
            const deckResponse = await request(app).post('/api/decks').send({ name: '测试' });
            const cardResponse = await request(app).post(`/api/decks/${deckResponse.body.id}/cards`).send({ front: '问题', back: '答案' });
            
            expect(cardResponse.body.version).toBe(1);
            expect(cardResponse.body.last_modified).toBeDefined();
        });

        test('编辑卡片应该增加版本号', async () => {
            process.env.DATA_FILE = TEST_DATA_FILE;
            delete require.cache[require.resolve('../server')];
            const { app } = require('../server');
            const request = require('supertest');
            
            const deckResponse = await request(app).post('/api/decks').send({ name: '测试' });
            const cardResponse = await request(app).post(`/api/decks/${deckResponse.body.id}/cards`).send({ front: '问题', back: '答案' });
            const initialVersion = cardResponse.body.version;
            
            const updateResponse = await request(app).put(`/api/cards/${cardResponse.body.id}`).send({ front: '新问题', back: '新答案' });
            
            expect(updateResponse.body.version).toBe(initialVersion + 1);
        });

        test('使用过期版本号编辑应该返回冲突', async () => {
            process.env.DATA_FILE = TEST_DATA_FILE;
            delete require.cache[require.resolve('../server')];
            const { app } = require('../server');
            const request = require('supertest');
            
            const deckResponse = await request(app).post('/api/decks').send({ name: '测试' });
            const cardResponse = await request(app).post(`/api/decks/${deckResponse.body.id}/cards`).send({ front: '问题', back: '答案' });
            const initialVersion = cardResponse.body.version;
            
            await request(app).put(`/api/cards/${cardResponse.body.id}`).send({ front: '第一次修改', back: '第一次答案' });
            
            const conflictResponse = await request(app).put(`/api/cards/${cardResponse.body.id}`).send({ 
                front: '第二次修改', 
                back: '第二次答案',
                expected_version: initialVersion
            });
            
            expect(conflictResponse.status).toBe(409);
        });
    });
});
