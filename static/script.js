console.log("✅ script.js loaded!");

// ===== Supabase Connection =====
const SUPABASE_URL = "https://qxaltrxknbkrgkegfobk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4YWx0cnhrbmJrcmdrZWdmb2JrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1NDk2MjcsImV4cCI6MjEwNTEyNTYyN30.eCgX-vKMc_JuAsg0wume-fWSWMdjiwOVv_QeUlfru68";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== Elements =====
const chatBox = document.getElementById('chat-box');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const imageBtn = document.getElementById('image-btn');
const authScreen = document.getElementById('auth-screen');
const appScreen = document.getElementById('app-screen');
const welcomeScreen = document.getElementById('welcome-screen');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');

let isWaiting = false;
let isImageMode = false;
let currentUser = null;
let currentAudio = null;

// ===== Session ID =====
let currentSessionId = localStorage.getItem('current_session') || generateSessionId();

function generateSessionId() {
    const id = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('current_session', id);
    return id;
}

function startNewSession() {
    currentSessionId = generateSessionId();
    console.log("🆕 New session:", currentSessionId);
}

// ===== Sidebar — FIX شده =====
function toggleSidebar() {
    sidebar.classList.toggle('closed');
    
    // ✅ توی موبایل: دکمه همیشه نشون داده بشه
    if (window.innerWidth <= 768) {
        if (sidebarToggle) sidebarToggle.style.display = 'flex';
    }
    
    if (!sidebar.classList.contains('closed')) {
        loadSessions();
    }
}

// ===== Edge TTS =====
async function playTTS(text) {
    if (!text || !text.trim()) return;
    
    try {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        
        const response = await fetch('/tts', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({text: text})
        });
        
        if (!response.ok) return;
        
        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        
        currentAudio = new Audio(audioUrl);
        
        return new Promise((resolve) => {
            currentAudio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                resolve();
            };
            currentAudio.onerror = () => {
                URL.revokeObjectURL(audioUrl);
                resolve();
            };
            currentAudio.play();
        });
    } catch (error) {
        console.error("❌ TTS error:", error);
    }
}

// ========================================
// 📞 Voice Call
// ========================================

let callActive = false;
let callRecognition = null;
let callTimerInterval = null;
let callSeconds = 0;
let isAISpeaking = false;
let isListening = false;
let silenceTimer = null;
let accumulatedTranscript = '';

function startVoiceCall() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        alert('Your browser does not support voice calls. Use Chrome!');
        return;
    }
    
    callActive = true;
    callSeconds = 0;
    isAISpeaking = false;
    isListening = false;
    accumulatedTranscript = '';
    
    document.getElementById('call-screen').style.display = 'flex';
    document.getElementById('call-timer').textContent = '00:00';
    document.getElementById('call-transcript-text').textContent = '';
    document.getElementById('call-status-text').textContent = 'Tap the mic to start';
    document.getElementById('call-status-icon').textContent = '🎤';
    
    callTimerInterval = setInterval(() => {
        callSeconds++;
        const mins = Math.floor(callSeconds / 60).toString().padStart(2, '0');
        const secs = (callSeconds % 60).toString().padStart(2, '0');
        document.getElementById('call-timer').textContent = `${mins}:${secs}`;
    }, 1000);
    
    updateCallStatus('idle');
}

function toggleCallMicrophone() {
    if (!callActive) return;
    if (isAISpeaking) return;
    
    if (callRecognition && isListening) {
        try { callRecognition.stop(); } catch(e) {}
        isListening = false;
        updateCallStatus('idle');
        return;
    }
    
    startContinuousRecognition();
}

function startContinuousRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (callRecognition) {
        try { callRecognition.stop(); } catch(e) {}
    }
    
    callRecognition = new SpeechRecognition();
    callRecognition.continuous = true;
    callRecognition.interimResults = true;
    callRecognition.lang = 'en-US';
    
    callRecognition.onstart = () => {
        isListening = true;
        if (!isAISpeaking) updateCallStatus('listening');
    };
    
    callRecognition.onresult = (event) => {
        if (isAISpeaking) return;
        
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                accumulatedTranscript += transcript + ' ';
            } else {
                interimTranscript += transcript;
            }
        }
        
        document.getElementById('call-transcript-text').textContent = accumulatedTranscript + interimTranscript;
        
        if (silenceTimer) clearTimeout(silenceTimer);
        
        silenceTimer = setTimeout(() => {
            const finalText = accumulatedTranscript.trim() || interimTranscript.trim();
            if (finalText && callActive && !isAISpeaking) {
                accumulatedTranscript = '';
                sendCallMessage(finalText);
            }
        }, 2500);
    };
    
    callRecognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
            endVoiceCall();
        }
    };
    
    callRecognition.onend = () => {
        isListening = false;
    };
    
    try { callRecognition.start(); } catch(e) {}
}

async function sendCallMessage(message) {
    if (!message.trim() || !callActive) return;
    
    isAISpeaking = true;
    isListening = false;
    if (callRecognition) try { callRecognition.stop(); } catch(e) {}
    
    updateCallStatus('thinking');
    
    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                message: message,
                user_id: currentUser ? currentUser.id : 'anonymous',
                session_id: currentSessionId
            })
        });
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullReply = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullReply += decoder.decode(value, { stream: true });
            document.getElementById('call-transcript-text').textContent = fullReply;
        }
        
        updateCallStatus('speaking');
        await playTTS(fullReply);
        afterSpeaking();
        
    } catch (error) {
        isAISpeaking = false;
        if (callActive) {
            updateCallStatus('idle');
        }
    }
}

function afterSpeaking() {
    isAISpeaking = false;
    isListening = false;
    accumulatedTranscript = '';
    
    if (callActive) {
        updateCallStatus('idle');
        document.getElementById('call-transcript-text').textContent = '';
    }
}

function updateCallStatus(status) {
    const icon = document.getElementById('call-status-icon');
    const text = document.getElementById('call-status-text');
    const waveContainer = document.getElementById('wave-container');
    const endBtn = document.querySelector('.call-end-btn');
    
    waveContainer.classList.remove('listening', 'speaking');
    
    if (status === 'idle') {
        icon.textContent = '🎤';
        text.textContent = 'Tap the mic to start';
        if (endBtn) {
            endBtn.innerHTML = `
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                </svg>
            `;
            endBtn.onclick = toggleCallMicrophone;
            endBtn.style.background = 'var(--accent-gradient)';
            endBtn.style.transform = 'none';
        }
    } else if (status === 'listening') {
        icon.textContent = '🔴';
        text.textContent = 'Listening...';
        waveContainer.classList.add('listening');
        if (endBtn) {
            endBtn.innerHTML = `
                <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
            `;
            endBtn.onclick = toggleCallMicrophone;
            endBtn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        }
    } else if (status === 'thinking') {
        icon.textContent = '💭';
        text.textContent = 'Thinking...';
    } else if (status === 'speaking') {
        icon.textContent = '🔊';
        text.textContent = 'Speaking...';
        waveContainer.classList.add('speaking');
    }
}

function endVoiceCall() {
    console.log("📞 Ending call");
    
    callActive = false;
    isAISpeaking = false;
    isListening = false;
    accumulatedTranscript = '';
    
    if (callRecognition) {
        try { callRecognition.stop(); } catch(e) {}
        callRecognition = null;
    }
    
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
    
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    
    document.getElementById('call-screen').style.display = 'none';
    
    const endBtn = document.querySelector('.call-end-btn');
    if (endBtn) {
        endBtn.innerHTML = `
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
            </svg>
        `;
        endBtn.onclick = endVoiceCall;
        endBtn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        endBtn.style.transform = 'rotate(135deg)';
    }
    
    if (currentUser) {
        authScreen.style.display = 'none';
        appScreen.style.display = 'flex';
    }
}

// ========================================
// 📜 History
// ========================================

let historyData = [];

async function loadSessions() {
    if (!currentUser) return;
    
    try {
        const response = await fetch(`/sessions/${currentUser.id}`);
        const data = await response.json();
        historyData = data.sessions || [];
        renderSessions(historyData);
    } catch (error) {
        console.error("❌ Sessions error:", error);
    }
}

function renderSessions(sessions) {
    const list = document.getElementById('history-list');
    
    if (!sessions || sessions.length === 0) {
        list.innerHTML = '<div class="empty-history"><p>No conversations yet</p></div>';
        return;
    }
    
    list.innerHTML = '';
    
    sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'history-item';
        if (session.session_id === currentSessionId) item.classList.add('active');
        
        const preview = session.first_message?.substring(0, 40) || 'Conversation';
        
        item.innerHTML = `
            <div class="history-item-title">${escapeHtml(preview)}${preview.length >= 40 ? '...' : ''}</div>
            <div class="history-item-preview">${session.count} messages</div>
        `;
        
        item.onclick = () => loadSession(session.session_id);
        list.appendChild(item);
    });
}

async function loadSession(sessionId) {
    if (!currentUser) return;
    
    try {
        const response = await fetch(`/session/${currentUser.id}/${sessionId}`);
        const data = await response.json();
        
        chatBox.innerHTML = '';
        
        (data.messages || []).forEach(msg => {
            addMessage(msg.content, msg.role === 'user' ? 'user' : 'bot');
        });
        
        currentSessionId = sessionId;
        localStorage.setItem('current_session', sessionId);
        
        if (window.innerWidth <= 768) toggleSidebar();
    } catch (error) {
        console.error("❌ Error:", error);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function clearChatAndClose() {
    startNewSession();
    chatBox.innerHTML = '';
    location.reload();
}

// ========================================
// 🔐 Auth
// ========================================

function switchAuthTab(tab) {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');

    if (tab === 'login') {
        loginForm.classList.add('active');
        signupForm.classList.remove('active');
        tabLogin.classList.add('active');
        tabSignup.classList.remove('active');
    } else {
        loginForm.classList.remove('active');
        signupForm.classList.add('active');
        tabLogin.classList.remove('active');
        tabSignup.classList.add('active');
    }
}

async function handleSignup() {
    const name = document.getElementById('signup-name').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const errorEl = document.getElementById('signup-error');
    const btn = document.getElementById('signup-btn');

    errorEl.textContent = '';

    if (!name || !email || !password) {
        errorEl.textContent = 'Please fill all fields!';
        return;
    }
    if (password.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters!';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Wait...';

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: { data: { name: name } }
        });

        if (error) throw error;
        errorEl.style.color = '#4ade80';
        errorEl.textContent = '✅ Success!';
        setTimeout(() => showApp(data.user), 800);
    } catch (error) {
        errorEl.style.color = '#f5576c';
        errorEl.textContent = error.message || 'Error!';
        btn.disabled = false;
        btn.textContent = 'Sign Up';
    }
}

async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');

    errorEl.textContent = '';

    if (!email || !password) {
        errorEl.textContent = 'Please enter email and password!';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Wait...';

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        showApp(data.user);
    } catch (error) {
        errorEl.textContent = 'Invalid email or password!';
        btn.disabled = false;
        btn.textContent = 'Login';
    }
}

async function handleLogout() {
    if (currentAudio) currentAudio.pause();
    if (callActive) endVoiceCall();
    await supabaseClient.auth.signOut();
    currentUser = null;
    authScreen.style.display = 'flex';
    appScreen.style.display = 'none';
}

// ✅ showApp — FIX شده
function showApp(user) {
    currentUser = user;
    authScreen.style.display = 'none';
    appScreen.style.display = 'flex';

    document.getElementById('user-avatar').textContent = 'MU';
    document.getElementById('header-name').textContent = 'MU.AI';
    
    // ✅ توی موبایل: دکمه ☰ همیشه نشون داده بشه
    if (window.innerWidth <= 768) {
        sidebar.classList.add('closed');
        if (sidebarToggle) sidebarToggle.style.display = 'flex';
    } else {
        sidebar.classList.remove('closed');
        if (sidebarToggle) sidebarToggle.style.display = 'none';
    }
}

async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user) {
        showApp(session.user);
    } else {
        authScreen.style.display = 'flex';
        appScreen.style.display = 'none';
    }
}

// ========================================
// 🖼️ Image Mode
// ========================================

function toggleImageMode() {
    isImageMode = !isImageMode;
    if (!imageBtn) return;
    
    if (isImageMode) {
        userInput.placeholder = "🖼️ Describe your image...";
        imageBtn.style.color = 'var(--accent)';
    } else {
        userInput.placeholder = "Ask MU.AI...";
        imageBtn.style.color = '';
    }
    userInput.focus();
}

// ========================================
// 💬 Send Message
// ========================================

function quickAsk(text) {
    userInput.value = text;
    sendMessage();
}

async function sendMessage() {
    const message = userInput.value.trim();
    if (!message || isWaiting) return;

    if (welcomeScreen && welcomeScreen.parentNode) welcomeScreen.style.display = 'none';
    
    addMessage(message, 'user');
    userInput.value = '';

    if (isImageMode) {
        await generateImage(message);
    } else {
        await sendChatMessage(message);
    }
}

async function sendChatMessage(message) {
    isWaiting = true;
    sendBtn.disabled = true;
    if (imageBtn) imageBtn.disabled = true;

    const botMsgDiv = document.createElement('div');
    botMsgDiv.className = 'message bot';
    
    const botAvatar = document.createElement('div');
    botAvatar.className = 'message-avatar';
    botAvatar.textContent = 'MU';
    
    const botContent = document.createElement('div');
    botContent.className = 'message-content';
    botContent.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    
    botMsgDiv.appendChild(botAvatar);
    botMsgDiv.appendChild(botContent);
    chatBox.appendChild(botMsgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    let fullReply = '';

    try {
        const response = await fetch('/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                message: message,
                user_id: currentUser ? currentUser.id : 'anonymous',
                session_id: currentSessionId
            })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let firstChunk = true;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            
            if (firstChunk) {
                botContent.innerHTML = '';
                firstChunk = false;
            }
            
            fullReply += chunk;
            botContent.textContent = fullReply;
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        if (!fullReply.trim()) {
            botContent.textContent = "Hmm, I didn't get that. Try again!";
        }

    } catch (error) {
        botContent.textContent = 'Sorry, something went wrong!';
    } finally {
        isWaiting = false;
        sendBtn.disabled = false;
        if (imageBtn) imageBtn.disabled = false;
        userInput.focus();
    }
}

async function generateImage(prompt) {
    isWaiting = true;
    sendBtn.disabled = true;
    if (imageBtn) imageBtn.disabled = true;

    const loadingMsg = addMessage('🎨 Creating your image...', 'bot');

    try {
        const response = await fetch('/generate-image', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({prompt: prompt})
        });
        const data = await response.json();
        loadingMsg.remove();

        if (data.error) {
            addMessage(data.error, 'bot');
        } else {
            addImageMessage(data.image);
        }
    } catch (error) {
        loadingMsg.remove();
        addMessage('Could not create image!', 'bot');
    } finally {
        isWaiting = false;
        sendBtn.disabled = false;
        if (imageBtn) imageBtn.disabled = false;
        userInput.focus();
    }
}

function addImageMessage(imageSrc) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot';

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = 'MU';

    const content = document.createElement('div');
    content.className = 'message-content';

    const img = document.createElement('img');
    img.src = imageSrc;
    img.className = 'generated-image';

    const downloadBtn = document.createElement('a');
    downloadBtn.href = imageSrc;
    downloadBtn.download = 'mu-ai-' + Date.now() + '.png';
    downloadBtn.textContent = '⬇️ Download';
    downloadBtn.className = 'download-btn-inline';

    content.appendChild(img);
    content.appendChild(document.createElement('br'));
    content.appendChild(downloadBtn);

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function addMessage(text, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = type === 'user' ? '👤' : 'MU';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    return messageDiv;
}

userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

// ===== Start =====
checkAuth();