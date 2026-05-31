const API_BASE = '/api';
const PAGE_SIZE = 50;

class App {
    constructor() {
        this.currentView = 'decks';
        this.currentDeck = null;
        this.reviewCards = [];
        this.reviewIndex = 0;
        this.reviewedCount = 0;
        this.timezoneOffset = new Date().getTimezoneOffset();
        this.currentDeckCards = [];
        this.cardCache = new Map();
        this.deckCache = new Map();
        
        this.currentExam = null;
        this.examCurrentIndex = 0;
        this.examAnswers = {};
        this.examTimer = null;
        this.examEndTime = null;

        this.synth = window.speechSynthesis;
        this.currentUtterance = null;
        
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadStats();
        await this.loadDecks();
    }

    bindEvents() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchView(e.target.dataset.view));
        });

        document.getElementById('new-deck-btn').addEventListener('click', () => this.openDeckModal());
        document.getElementById('back-to-decks').addEventListener('click', () => this.showDecksView());
        document.getElementById('back-from-review').addEventListener('click', () => this.showDecksView());
        document.getElementById('new-card-btn').addEventListener('click', () => this.openCardModal());
        document.getElementById('review-deck-btn').addEventListener('click', () => this.startDeckReview());
        document.getElementById('show-answer-btn').addEventListener('click', () => this.showAnswer());
        document.getElementById('review-card').addEventListener('click', () => this.toggleCardFlip());
        document.getElementById('complete-btn').addEventListener('click', () => this.showDecksView());

        document.querySelectorAll('.rating-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.rateCard(parseInt(e.target.dataset.rating)));
        });

        document.querySelector('.modal .close').addEventListener('click', () => this.closeModal());
        document.getElementById('modal').addEventListener('click', (e) => {
            if (e.target.id === 'modal') this.closeModal();
        });

        document.getElementById('community-search').addEventListener('input', () => this.debounceSearch());
        document.getElementById('community-sort').addEventListener('change', () => this.loadSharedDecks());

        document.getElementById('new-exam-btn').addEventListener('click', () => this.openExamModal());
        document.getElementById('exam-prev-btn').addEventListener('click', () => this.prevExamCard());
        document.getElementById('exam-next-btn').addEventListener('click', () => this.nextExamCard());
        document.getElementById('exam-submit-btn').addEventListener('click', () => this.submitExam());
        document.getElementById('exam-back-btn').addEventListener('click', () => this.showExamListView());
        document.getElementById('exam-retry-btn').addEventListener('click', () => this.retryExam());
        document.getElementById('exam-read-front').addEventListener('click', () => this.readExamQuestion());

        document.getElementById('exam-answer-input').addEventListener('input', (e) => {
            if (this.currentExam) {
                const cardId = this.currentExam.cards[this.examCurrentIndex].card_id;
                this.examAnswers[cardId] = e.target.value;
            }
        });
    }

    debounceSearch() {
        if (this.searchTimeout) clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.loadSharedDecks(), 300);
    }

    async request(url, options = {}) {
        const separator = url.includes('?') ? '&' : '?';
        const urlWithTimezone = `${url}${separator}timezone_offset=${this.timezoneOffset}`;
        
        const response = await fetch(API_BASE + urlWithTimezone, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const error = new Error(`HTTP error! status: ${response.status}`);
            error.status = response.status;
            error.data = errorData;
            throw error;
        }
        
        return response.json();
    }

    async loadStats() {
        try {
            const stats = await this.request('/stats');
            const statsContainer = document.getElementById('stats');
            statsContainer.innerHTML = `
                <div class="stat-item">
                    <div class="stat-number">${stats.totalDecks}</div>
                    <div class="stat-label">卡片组</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">${stats.totalCards}</div>
                    <div class="stat-label">总卡片</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">${stats.dueToday}</div>
                    <div class="stat-label">待复习</div>
                </div>
                <div class="stat-item">
                    <div class="stat-number">${stats.totalSharedDecks || 0}</div>
                    <div class="stat-label">社区</div>
                </div>
            `;
        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    }

    async loadDecks() {
        try {
            const decks = await this.request('/decks');
            this.deckCache.clear();
            decks.forEach(deck => this.deckCache.set(deck.id, deck));
            
            const container = document.getElementById('decks-list');
            
            if (decks.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="width: 100%;">
                        <div class="empty-state-icon">📚</div>
                        <h3>还没有卡片组</h3>
                        <p>点击上方按钮创建你的第一个卡片组</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = decks.map(deck => `
                <div class="deck-card" data-deck-id="${deck.id}">
                    <h3>${deck.name}</h3>
                    <p>${deck.description || '暂无描述'}</p>
                    <div class="deck-meta">
                        <span class="card-count">${deck.card_count || 0} 张卡片</span>
                        <span class="due-badge ${deck.due_count > 0 ? 'active' : ''}">
                            ${deck.due_count || 0} 待复习
                        </span>
                    </div>
                    <div class="deck-actions-btns">
                        <button class="edit-btn" onclick="event.stopPropagation(); app.editDeck(${deck.id})">编辑</button>
                        <button class="share-btn" onclick="event.stopPropagation(); app.shareDeck(${deck.id})">分享</button>
                        <button class="delete-btn" onclick="event.stopPropagation(); app.deleteDeck(${deck.id})">删除</button>
                    </div>
                </div>
            `).join('');

            container.querySelectorAll('.deck-card').forEach(card => {
                card.addEventListener('click', () => {
                    this.showDeckCards(parseInt(card.dataset.deckId));
                });
            });
        } catch (error) {
            console.error('Failed to load decks:', error);
        }
    }

    switchView(viewName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewName);
        });

        if (viewName === 'review') {
            this.startGlobalReview();
        } else if (viewName === 'community') {
            this.showCommunityView();
        } else if (viewName === 'exam') {
            this.showExamListView();
        } else {
            this.showDecksView();
        }
    }

    showView(viewId) {
        document.querySelectorAll('.view').forEach(view => {
            view.classList.remove('active');
        });
        document.getElementById(viewId).classList.add('active');
        this.currentView = viewId;
    }

    showDecksView() {
        this.showView('decks-view');
        this.currentDeck = null;
        this.loadStats();
        this.loadDecks();
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === 'decks');
        });
    }

    async showDeckCards(deckId) {
        try {
            const deck = this.deckCache.get(deckId);
            if (!deck) {
                const decks = await this.request('/decks');
                const foundDeck = decks.find(d => d.id === deckId);
                if (!foundDeck) return;
                this.currentDeck = foundDeck;
            } else {
                this.currentDeck = deck;
            }
            
            document.getElementById('deck-title').textContent = this.currentDeck.name;
            
            this.showView('cards-view');
            await this.loadCards(deckId);
        } catch (error) {
            console.error('Failed to load deck:', error);
        }
    }

    async loadCards(deckId) {
        try {
            const cards = await this.request(`/decks/${deckId}/cards`);
            this.currentDeckCards = cards;
            this.cardCache.clear();
            cards.forEach(card => this.cardCache.set(card.id, card));
            
            const container = document.getElementById('cards-list');
            
            if (cards.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="background: rgba(255,255,255,0.1); border-radius: 20px;">
                        <div class="empty-state-icon">🃏</div>
                        <h3>还没有卡片</h3>
                        <p>点击上方按钮创建你的第一张卡片</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = cards.map((card, index) => `
                <div class="card-item" data-card-id="${card.id}">
                    <div class="card-item-header">
                        <h4>卡片 #${cards.length - index}</h4>
                        <div class="card-info">
                            <span class="next-review">下次复习: ${card.next_review}</span>
                            <span class="interval-info">间隔: ${card.interval}天</span>
                            <span class="easiness-info">难度: ${card.easiness}</span>
                        </div>
                    </div>
                    <div class="card-front-preview">Q: ${card.front}</div>
                    <div class="card-back-preview">A: ${card.back}</div>
                    <div class="card-item-actions">
                        <button class="btn-secondary" onclick="app.speakText('${this.escapeHtml(card.front)}')">🔊 朗读问题</button>
                        <button class="btn-secondary" onclick="app.editCard(${card.id}, '${this.escapeHtml(card.front)}', '${this.escapeHtml(card.back)}', ${card.version || 1})">编辑</button>
                        <button class="btn-secondary" style="background: #fee2e2; color: #dc2626;" onclick="app.deleteCard(${card.id})">删除</button>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Failed to load cards:', error);
        }
    }

    speakText(text) {
        if (this.synth) {
            this.synth.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'zh-CN';
            utterance.rate = 0.9;
            this.synth.speak(utterance);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML.replace(/'/g, "\\'");
    }

    openDeckModal(deck = null) {
        const modal = document.getElementById('modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = deck ? '编辑卡片组' : '新建卡片组';
        body.innerHTML = `
            <div class="form-group">
                <label>名称</label>
                <input type="text" id="deck-name" value="${deck ? deck.name : ''}" placeholder="输入卡片组名称">
            </div>
            <div class="form-group">
                <label>描述</label>
                <textarea id="deck-description" placeholder="输入描述（可选）">${deck ? deck.description || '' : ''}</textarea>
            </div>
            <div class="form-actions">
                <button class="btn-secondary" onclick="app.closeModal()">取消</button>
                <button class="btn-primary" onclick="app.saveDeck(${deck ? deck.id : 'null'}, ${deck ? deck.version : 'null'})">保存</button>
            </div>
        `;

        modal.style.display = 'flex';
    }

    async saveDeck(deckId, expectedVersion = null) {
        const name = document.getElementById('deck-name').value.trim();
        const description = document.getElementById('deck-description').value.trim();

        if (!name) {
            alert('请输入卡片组名称');
            return;
        }

        try {
            if (deckId) {
                const body = { name, description };
                if (expectedVersion !== null) {
                    body.expected_version = expectedVersion;
                }
                
                await this.request(`/decks/${deckId}`, {
                    method: 'PUT',
                    body: JSON.stringify(body)
                });
            } else {
                await this.request('/decks', {
                    method: 'POST',
                    body: JSON.stringify({ name, description })
                });
            }
            
            this.closeModal();
            await this.loadStats();
            await this.loadDecks();
        } catch (error) {
            if (error.status === 409) {
                const retry = confirm(`检测到冲突：该卡片组已被其他用户修改。\n\n${error.data && error.data.error || ''}\n\n是否使用最新版本重试？`);
                if (retry) {
                    await this.loadDecks();
                    const deck = this.deckCache.get(deckId);
                    if (deck) {
                        this.openDeckModal(deck);
                    }
                }
            } else {
                console.error('Failed to save deck:', error);
                alert('保存失败，请重试');
            }
        }
    }

    async editDeck(deckId) {
        const deck = this.deckCache.get(deckId);
        if (deck) {
            this.openDeckModal(deck);
        } else {
            const decks = await this.request('/decks');
            const foundDeck = decks.find(d => d.id === deckId);
            if (foundDeck) {
                this.openDeckModal(foundDeck);
            }
        }
    }

    async shareDeck(deckId) {
        const deck = this.deckCache.get(deckId);
        if (!deck) return;

        const modal = document.getElementById('modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = '分享卡片组到社区';
        body.innerHTML = `
            <div class="form-group">
                <label>标题</label>
                <input type="text" id="share-title" value="${deck.name}" placeholder="输入分享标题">
            </div>
            <div class="form-group">
                <label>描述</label>
                <textarea id="share-description" placeholder="输入描述（可选）">${deck.description || ''}</textarea>
            </div>
            <div class="form-group">
                <label>作者名称</label>
                <input type="text" id="share-author" placeholder="输入你的名字（可选）">
            </div>
            <div class="form-group">
                <label>标签（用逗号分隔）</label>
                <input type="text" id="share-tags" placeholder="例如：英语, 考试, 学习">
            </div>
            <div class="form-actions">
                <button class="btn-secondary" onclick="app.closeModal()">取消</button>
                <button class="btn-primary" onclick="app.submitShare(${deckId})">发布分享</button>
            </div>
        `;

        modal.style.display = 'flex';
    }

    async submitShare(deckId) {
        const title = document.getElementById('share-title').value.trim();
        const description = document.getElementById('share-description').value.trim();
        const author = document.getElementById('share-author').value.trim() || '匿名用户';
        const tagsInput = document.getElementById('share-tags').value.trim();
        const tags = tagsInput ? tagsInput.split(/[,，]/).map(t => t.trim()).filter(t => t) : [];

        if (!title) {
            alert('请输入标题');
            return;
        }

        try {
            await this.request(`/decks/${deckId}/share`, {
                method: 'POST',
                body: JSON.stringify({ title, description, author, tags })
            });

            this.closeModal();
            alert('分享成功！已发布到社区广场');
            await this.loadStats();
        } catch (error) {
            console.error('Failed to share deck:', error);
            alert('分享失败，请重试');
        }
    }

    async deleteDeck(deckId) {
        if (!confirm('确定要删除这个卡片组吗？所有卡片也会被删除。')) {
            return;
        }

        try {
            await this.request(`/decks/${deckId}`, { method: 'DELETE' });
            await this.loadStats();
            await this.loadDecks();
        } catch (error) {
            console.error('Failed to delete deck:', error);
            alert('删除失败，请重试');
        }
    }

    openCardModal(card = null) {
        const modal = document.getElementById('modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = card ? '编辑卡片' : '新建卡片';
        body.innerHTML = `
            <div class="form-group">
                <label>正面（问题）</label>
                <textarea id="card-front" placeholder="输入问题或提示">${card ? card.front : ''}</textarea>
            </div>
            <div class="form-group">
                <label>背面（答案）</label>
                <textarea id="card-back" placeholder="输入答案或解释">${card ? card.back : ''}</textarea>
            </div>
            <div class="form-group">
                <label class="checkbox-label">
                    <input type="checkbox" id="card-speak" checked> 朗读问题和答案
                </label>
            </div>
            <div class="form-actions">
                <button class="btn-secondary" onclick="app.closeModal()">取消</button>
                <button class="btn-primary" onclick="app.saveCard(${card ? card.id : 'null'}, ${card ? card.version : 'null'})">保存</button>
            </div>
        `;

        modal.style.display = 'flex';
    }

    async saveCard(cardId, expectedVersion = null) {
        const front = document.getElementById('card-front').value.trim();
        const back = document.getElementById('card-back').value.trim();

        if (!front || !back) {
            alert('请填写正面和背面内容');
            return;
        }

        try {
            if (cardId) {
                const body = { front, back };
                if (expectedVersion !== null) {
                    body.expected_version = expectedVersion;
                }
                
                await this.request(`/cards/${cardId}`, {
                    method: 'PUT',
                    body: JSON.stringify(body)
                });
            } else {
                await this.request(`/decks/${this.currentDeck.id}/cards`, {
                    method: 'POST',
                    body: JSON.stringify({ front, back })
                });
            }
            
            this.closeModal();
            await this.loadCards(this.currentDeck.id);
            await this.loadStats();
        } catch (error) {
            if (error.status === 409) {
                const retry = confirm(`检测到冲突：该卡片已被其他用户修改。\n\n${error.data && error.data.error || ''}\n\n是否使用最新版本重试？`);
                if (retry) {
                    await this.loadCards(this.currentDeck.id);
                    const card = this.cardCache.get(cardId);
                    if (card) {
                        this.openCardModal(card);
                    }
                }
            } else {
                console.error('Failed to save card:', error);
                alert('保存失败，请重试');
            }
        }
    }

    editCard(cardId, front, back, version = 1) {
        this.openCardModal({ id: cardId, front, back, version });
    }

    async deleteCard(cardId) {
        if (!confirm('确定要删除这张卡片吗？')) {
            return;
        }

        try {
            await this.request(`/cards/${cardId}`, { method: 'DELETE' });
            await this.loadCards(this.currentDeck.id);
            await this.loadStats();
        } catch (error) {
            console.error('Failed to delete card:', error);
            alert('删除失败，请重试');
        }
    }

    closeModal() {
        document.getElementById('modal').style.display = 'none';
    }

    async startGlobalReview() {
        try {
            this.reviewCards = [];
            let offset = 0;
            let hasMore = true;
            
            while (hasMore) {
                const response = await this.request(`/review/due?limit=${PAGE_SIZE}&offset=${offset}`);
                
                if (Array.isArray(response)) {
                    this.reviewCards = response;
                    hasMore = false;
                } else {
                    this.reviewCards = this.reviewCards.concat(response.cards || []);
                    hasMore = response.hasMore || false;
                    offset += PAGE_SIZE;
                }
            }
            
            this.startReview();
        } catch (error) {
            console.error('Failed to load review cards:', error);
        }
    }

    async startDeckReview() {
        try {
            this.reviewCards = [];
            let offset = 0;
            let hasMore = true;
            
            while (hasMore) {
                const response = await this.request(`/review/due?deckId=${this.currentDeck.id}&limit=${PAGE_SIZE}&offset=${offset}`);
                
                if (Array.isArray(response)) {
                    this.reviewCards = response;
                    hasMore = false;
                } else {
                    this.reviewCards = this.reviewCards.concat(response.cards || []);
                    hasMore = response.hasMore || false;
                    offset += PAGE_SIZE;
                }
            }
            
            this.startReview();
        } catch (error) {
            console.error('Failed to load review cards:', error);
        }
    }

    startReview() {
        this.reviewIndex = 0;
        this.reviewedCount = 0;
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === 'review');
        });

        this.showView('review-view');
        document.getElementById('review-container').style.display = 'flex';
        document.getElementById('review-complete').style.display = 'none';
        
        if (this.reviewCards.length === 0) {
            this.showReviewComplete();
        } else {
            this.showCurrentCard();
        }
    }

    showCurrentCard() {
        if (this.reviewIndex >= this.reviewCards.length) {
            this.showReviewComplete();
            return;
        }

        const card = this.reviewCards[this.reviewIndex];
        
        document.getElementById('front-content').textContent = card.front;
        document.getElementById('back-content').textContent = card.back;
        document.getElementById('review-progress-text').textContent = `${this.reviewIndex + 1} / ${this.reviewCards.length}`;
        
        const cardWrapper = document.getElementById('review-card');
        cardWrapper.classList.remove('flipped');
        
        document.getElementById('review-controls').style.display = 'block';
        document.getElementById('rating-buttons').style.display = 'none';

        if (this.synth && this.reviewIndex === 0) {
            this.synth.cancel();
        }
    }

    toggleCardFlip() {
        const cardWrapper = document.getElementById('review-card');
        if (cardWrapper.classList.contains('flipped')) {
            return;
        }
    }

    showAnswer() {
        const cardWrapper = document.getElementById('review-card');
        cardWrapper.classList.add('flipped');
        
        document.getElementById('review-controls').style.display = 'none';
        document.getElementById('rating-buttons').style.display = 'flex';
    }

    async rateCard(quality) {
        const card = this.reviewCards[this.reviewIndex];
        
        try {
            await this.request(`/review/${card.id}`, {
                method: 'POST',
                body: JSON.stringify({ 
                    quality,
                    timezone_offset: this.timezoneOffset,
                    expected_version: card.version || 1
                })
            });
            
            this.reviewedCount++;
            this.reviewIndex++;
            this.showCurrentCard();
        } catch (error) {
            if (error.status === 409) {
                alert('该卡片已被其他用户修改，正在刷新卡片列表...');
                this.showDecksView();
            } else {
                console.error('Failed to rate card:', error);
                alert('评价失败，请重试');
            }
        }
    }

    showReviewComplete() {
        document.getElementById('review-container').style.display = 'none';
        document.getElementById('review-complete').style.display = 'block';
        
        document.getElementById('review-summary').textContent = 
            this.reviewedCount > 0 
                ? `太棒了！你今天复习了 ${this.reviewedCount} 张卡片` 
                : '今天没有需要复习的卡片，明天再来吧！';
    }

    async showCommunityView() {
        this.showView('community-view');
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === 'community');
        });
        await this.loadSharedDecks();
    }

    async loadSharedDecks() {
        try {
            const search = document.getElementById('community-search').value.trim();
            const sort = document.getElementById('community-sort').value;
            
            let url = `/shared-decks?sort=${sort}&limit=20`;
            if (search) {
                url += `&search=${encodeURIComponent(search)}`;
            }

            const response = await this.request(url);
            let decks = [];
            if (Array.isArray(response)) {
                decks = response;
            } else {
                decks = response.decks || [];
            }
            
            const container = document.getElementById('community-decks-list');
            
            if (decks.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="width: 100%;">
                        <div class="empty-state-icon">🌐</div>
                        <h3>社区广场暂无内容</h3>
                        <p>分享你的卡片组，让更多人看到</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = decks.map(deck => `
                <div class="deck-card community-deck">
                    <h3>${deck.title}</h3>
                    <p>${deck.description || '暂无描述'}</p>
                    <div class="deck-meta">
                        <span class="card-count">${deck.card_count || 0} 张卡片</span>
                        <span class="author-info">作者: ${deck.author}</span>
                    </div>
                    <div class="deck-stats">
                        <span class="stat">👁 ${deck.views || 0}</span>
                        <span class="stat">❤️ ${deck.likes || 0}</span>
                    </div>
                    <div class="deck-actions-btns">
                        <button class="edit-btn" onclick="app.likeSharedDeck(${deck.id})">点赞</button>
                        <button class="share-btn" onclick="app.importSharedDeck(${deck.id})">导入</button>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Failed to load shared decks:', error);
        }
    }

    async likeSharedDeck(deckId) {
        try {
            await this.request(`/shared-decks/${deckId}/like`, { method: 'POST' });
            await this.loadSharedDecks();
        } catch (error) {
            console.error('Failed to like deck:', error);
        }
    }

    async importSharedDeck(deckId) {
        if (!confirm('确定要导入这个卡片组吗？')) {
            return;
        }

        try {
            const result = await this.request(`/shared-decks/${deckId}/import`, { method: 'POST' });
            alert(`导入成功！创建了 ${result.cardCount} 张卡片`);
            await this.loadStats();
            this.showDecksView();
        } catch (error) {
            console.error('Failed to import deck:', error);
            alert('导入失败，请重试');
        }
    }

    async showExamListView() {
        this.showView('exam-view');
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === 'exam');
        });
        document.getElementById('exam-list-view').style.display = 'block';
        document.getElementById('exam-running-view').style.display = 'none';
        document.getElementById('exam-results-view').style.display = 'none';
        await this.loadExams();
    }

    async loadExams() {
        try {
            const exams = await this.request('/exams');
            const container = document.getElementById('exams-list');
            
            if (exams.length === 0) {
                container.innerHTML = `
                    <div class="empty-state" style="width: 100%;">
                        <div class="empty-state-icon">📝</div>
                        <h3>还没有考试</h3>
                        <p>点击上方按钮创建你的第一个模拟考试</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = exams.map(exam => `
                <div class="exam-item">
                    <div class="exam-info">
                        <h4>${exam.title}</h4>
                        <p>${exam.total_cards} 题 | ${exam.time_limit ? exam.time_limit + ' 分钟' : '无时间限制'}</p>
                    </div>
                    <div class="exam-status ${exam.status}">
                        ${exam.status === 'completed' ? `得分: ${exam.score || 0}分` : 
                          exam.status === 'in_progress' ? '进行中' : '未开始'}
                    </div>
                    <div class="exam-actions">
                        ${exam.status === 'pending' ? 
                            `<button class="btn-primary" onclick="app.startExam(${exam.id})">开始</button>` : 
                          exam.status === 'completed' ? 
                            `<button class="btn-secondary" onclick="app.viewExamResults(${exam.id})">查看结果</button>` : 
                            `<button class="btn-secondary" onclick="app.deleteExam(${exam.id})">删除</button>`}
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Failed to load exams:', error);
        }
    }

    async openExamModal() {
        const decks = await this.request('/decks');
        const modal = document.getElementById('modal');
        const title = document.getElementById('modal-title');
        const body = document.getElementById('modal-body');

        title.textContent = '创建模拟考试';
        body.innerHTML = `
            <div class="form-group">
                <label>考试标题</label>
                <input type="text" id="exam-title" placeholder="例如：英语单词测试">
            </div>
            <div class="form-group">
                <label>选择卡片组（可选，不选则使用全部卡片）</label>
                <select id="exam-deck">
                    <option value="">全部卡片</option>
                    ${decks.map(d => `<option value="${d.id}">${d.name} (${d.card_count || 0}张)</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>题目数量（0表示全部）</label>
                <input type="number" id="exam-card-count" min="0" value="0" placeholder="0 = 全部">
            </div>
            <div class="form-group">
                <label>时间限制（分钟，0表示不限时）</label>
                <input type="number" id="exam-time-limit" min="0" value="0" placeholder="0 = 不限时">
            </div>
            <div class="form-actions">
                <button class="btn-secondary" onclick="app.closeModal()">取消</button>
                <button class="btn-primary" onclick="app.createExam()">创建</button>
            </div>
        `;

        modal.style.display = 'flex';
    }

    async createExam() {
        const title = document.getElementById('exam-title').value.trim() || '模拟考试';
        const deckId = document.getElementById('exam-deck').value || null;
        const cardCount = parseInt(document.getElementById('exam-card-count').value) || 0;
        const timeLimit = parseInt(document.getElementById('exam-time-limit').value) || 0;

        try {
            const body = { title };
            if (deckId) body.deckId = deckId;
            if (cardCount > 0) body.cardCount = cardCount;
            if (timeLimit > 0) body.timeLimit = timeLimit;

            const exam = await this.request('/exams/create', {
                method: 'POST',
                body: JSON.stringify(body)
            });

            this.closeModal();
            await this.loadExams();
        } catch (error) {
            console.error('Failed to create exam:', error);
            alert('创建考试失败，请重试');
        }
    }

    async startExam(examId) {
        try {
            const result = await this.request(`/exams/${examId}/start`, { method: 'POST' });
            this.currentExam = result.exam;
            this.examCurrentIndex = 0;
            this.examAnswers = {};

            if (this.currentExam.time_limit > 0) {
                this.examEndTime = new Date().getTime() + this.currentExam.time_limit * 60000;
                this.startExamTimer();
            }

            this.showExamRunningView();
        } catch (error) {
            console.error('Failed to start exam:', error);
            alert('开始考试失败，请重试');
        }
    }

    startExamTimer() {
        if (this.examTimer) clearInterval(this.examTimer);
        
        this.examTimer = setInterval(() => {
            const now = new Date().getTime();
            const remaining = Math.max(0, this.examEndTime - now);
            
            if (remaining <= 0) {
                this.submitExam();
                return;
            }

            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            document.getElementById('exam-timer-display').textContent = 
                `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }, 1000);
    }

    showExamRunningView() {
        document.getElementById('exam-list-view').style.display = 'none';
        document.getElementById('exam-running-view').style.display = 'block';
        document.getElementById('exam-results-view').style.display = 'none';
        
        document.getElementById('exam-total-cards').textContent = this.currentExam.total_cards;
        this.updateExamCard();
    }

    updateExamCard() {
        const card = this.currentExam.cards[this.examCurrentIndex];
        document.getElementById('exam-current-card').textContent = this.examCurrentIndex + 1;
        document.getElementById('exam-question').textContent = card.front;
        document.getElementById('exam-answer-input').value = this.examAnswers[card.card_id] || '';
        document.getElementById('exam-answer-input').focus();
    }

    prevExamCard() {
        if (this.examCurrentIndex > 0) {
            const currentCard = this.currentExam.cards[this.examCurrentIndex];
            this.examAnswers[currentCard.card_id] = document.getElementById('exam-answer-input').value;
            this.examCurrentIndex--;
            this.updateExamCard();
        }
    }

    nextExamCard() {
        const currentCard = this.currentExam.cards[this.examCurrentIndex];
        this.examAnswers[currentCard.card_id] = document.getElementById('exam-answer-input').value;
        
        if (this.examCurrentIndex < this.currentExam.total_cards - 1) {
            this.examCurrentIndex++;
            this.updateExamCard();
        }
    }

    readExamQuestion() {
        const card = this.currentExam.cards[this.examCurrentIndex];
        this.speakText(card.front);
    }

    async submitExam() {
        if (!confirm('确定要提交试卷吗？')) {
            return;
        }

        if (this.examTimer) {
            clearInterval(this.examTimer);
            this.examTimer = null;
        }

        const currentCard = this.currentExam.cards[this.examCurrentIndex];
        this.examAnswers[currentCard.card_id] = document.getElementById('exam-answer-input').value;

        try {
            const result = await this.request(`/exams/${this.currentExam.id}/submit`, {
                method: 'POST',
                body: JSON.stringify({ answers: this.examAnswers })
            });

            this.showExamResults(result);
        } catch (error) {
            console.error('Failed to submit exam:', error);
            alert('提交失败，请重试');
        }
    }

    showExamResults(result) {
        document.getElementById('exam-list-view').style.display = 'none';
        document.getElementById('exam-running-view').style.display = 'none';
        document.getElementById('exam-results-view').style.display = 'block';

        const score = result.score;
        document.getElementById('exam-score').textContent = score;
        document.getElementById('exam-score').className = score >= 90 ? 'excellent' : score >= 70 ? 'good' : score >= 60 ? 'pass' : 'fail';
        
        document.getElementById('exam-correct-count').textContent = result.correct_count;
        document.getElementById('exam-wrong-count').textContent = result.total_cards - result.correct_count;
        document.getElementById('exam-total-count').textContent = result.total_cards;

        document.getElementById('exam-result-title').textContent = 
            score >= 90 ? '太棒了！🎉' : 
            score >= 70 ? '做得不错！👍' : 
            score >= 60 ? '继续加油！💪' : 
            '需要多多练习哦！📚';

        const detailsHtml = result.results.map((item, index) => `
            <div class="result-item ${item.is_correct ? 'correct' : 'wrong'}">
                <div class="result-header">
                    <span class="result-number">${index + 1}.</span>
                    <span class="result-icon">${item.is_correct ? '✓' : '✗'}</span>
                </div>
                <div class="result-question">问题: ${item.front}</div>
                <div class="result-correct">正确答案: ${item.correct_answer}</div>
                <div class="result-user">你的答案: ${item.user_answer || '(未作答)'}</div>
            </div>
        `).join('');

        document.getElementById('exam-results-details').innerHTML = detailsHtml;
    }

    async viewExamResults(examId) {
        try {
            const exam = await this.request(`/exams/${examId}/results`);
            this.showExamResults({
                score: exam.score,
                correct_count: exam.correct_count,
                total_cards: exam.total_cards,
                results: exam.results
            });
        } catch (error) {
            console.error('Failed to load exam results:', error);
        }
    }

    async retryExam() {
        await this.showExamListView();
        this.openExamModal();
    }

    async deleteExam(examId) {
        if (!confirm('确定要删除这个考试吗？')) {
            return;
        }

        try {
            await this.request(`/exams/${examId}`, { method: 'DELETE' });
            await this.loadExams();
        } catch (error) {
            console.error('Failed to delete exam:', error);
            alert('删除失败，请重试');
        }
    }
}

const app = new App();
