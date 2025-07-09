import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, addDoc, query, onSnapshot, serverTimestamp, doc, setDoc, getDoc } from 'firebase/firestore';
import { HelpCircle, BookText, FileQuestion, Camera, Loader2, Send, BrainCircuit, History, User, GraduationCap, X } from 'lucide-react';

// Firebase config - Read from environment variables (for Netlify) or global vars (for Canvas)
const firebaseConfig = (typeof process !== 'undefined' && process.env.REACT_APP_FIREBASE_CONFIG)
  ? JSON.parse(process.env.REACT_APP_FIREBASE_CONFIG)
  : (typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {});

const appId = (typeof process !== 'undefined' && process.env.REACT_APP_ID)
  ? process.env.REACT_APP_ID
  : (typeof __app_id !== 'undefined' ? __app_id : 'default-app-id');

const initialAuthToken = (typeof process !== 'undefined' && process.env.REACT_APP_INITIAL_AUTH_TOKEN)
  ? process.env.REACT_APP_INITIAL_AUTH_TOKEN
  : (typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null);


// MBTI Types
const mbtiTypes = [
    'INTJ', 'INTP', 'ENTJ', 'ENTP',
    'INFJ', 'INFP', 'ENFJ', 'ENFP',
    'ISTJ', 'ISFJ', 'ESTJ', 'ESFJ',
    'ISTP', 'ISFP', 'ESTP', 'ESFP'
];

// Main App Component
export default function App() {
    // Firebase state
    const [auth, setAuth] = useState(null);
    const [db, setDb] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // App state
    const [activeTab, setActiveTab] = useState('mentor');
    const [prompt, setPrompt] = useState('');
    const [imageFile, setImageFile] = useState(null);
    const [imageBase64, setImageBase64] = useState(null);
    const [response, setResponse] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [history, setHistory] = useState([]);
    const [error, setError] = useState('');
    const fileInputRef = useRef(null);

    // New state for mentoring
    const [studentMbti, setStudentMbti] = useState(null);
    const [showMbtiModal, setShowMbtiModal] = useState(false);


    // Initialize Firebase and Auth
    useEffect(() => {
        try {
            // Check if firebase config is valid
            if (!firebaseConfig.apiKey) {
                console.error("Firebase configuration is missing or invalid.");
                setError("Firebase 설정이 올바르지 않습니다. Netlify 환경 변수를 확인해주세요.");
                return;
            }
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const dbInstance = getFirestore(app);
            setAuth(authInstance);
            setDb(dbInstance);

            const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    // Fetch user's MBTI
                    const userDocRef = doc(dbInstance, `/artifacts/${appId}/users/${user.uid}`);
                    const userDocSnap = await getDoc(userDocRef);
                    if (userDocSnap.exists() && userDocSnap.data().mbti) {
                        setStudentMbti(userDocSnap.data().mbti);
                    } else {
                        setShowMbtiModal(true); // Show modal if MBTI is not set
                    }
                } else {
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(authInstance, initialAuthToken);
                        } else {
                            await signInAnonymously(authInstance);
                        }
                    } catch (authError) {
                        console.error("Authentication error:", authError);
                        setError("인증에 실패했습니다. 페이지를 새로고침 해주세요.");
                    }
                }
                setIsAuthReady(true);
            });
            return () => unsubscribe();
        } catch (e) {
            console.error("Firebase initialization error:", e);
            setError("앱을 초기화하는 데 실패했습니다. 구성 정보를 확인해주세요.");
        }
    }, []);

    // Fetch history from Firestore
    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;

        const historyCollectionPath = `/artifacts/${appId}/users/${userId}/studyHistory`;
        const q = query(collection(db, historyCollectionPath));
        
        const unsubscribe = onSnapshot(q, (querySnapshot) => {
            const historyData = [];
            querySnapshot.forEach((doc) => {
                historyData.push({ id: doc.id, ...doc.data() });
            });
            historyData.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
            setHistory(historyData);
        }, (err) => {
            console.error("Error fetching history: ", err);
            setError("학습 기록을 불러오는 데 실패했습니다.");
        });

        return () => unsubscribe();
    }, [isAuthReady, db, userId]);

    const handleMbtiSelect = async (mbti) => {
        if (!db || !userId) return;
        setStudentMbti(mbti);
        const userDocRef = doc(db, `/artifacts/${appId}/users/${userId}`);
        try {
            await setDoc(userDocRef, { mbti: mbti }, { merge: true });
            setShowMbtiModal(false);
        } catch (err) {
            console.error("Error saving MBTI:", err);
            setError("MBTI 정보를 저장하는 데 실패했습니다.");
        }
    };
    
    // Handle image selection
    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setImageFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setImageBase64(reader.result.split(',')[1]);
            };
            reader.readAsDataURL(file);
        }
    };

    // Call Gemini API
    const getAiResponse = async () => {
        if (!prompt && !imageBase64) {
            setError('질문, 텍스트 또는 이미지를 입력해주세요.');
            return;
        }
        if (activeTab === 'mentor' && !studentMbti) {
            setError('멘토링을 시작하기 전에 MBTI를 선택해주세요.');
            setShowMbtiModal(true);
            return;
        }

        setIsLoading(true);
        setResponse('');
        setError('');

        let fullPrompt;
        if (activeTab === 'mentor') {
            fullPrompt = `
                당신은 초등학생을 위한 AI 학습 멘토입니다. 이 학생의 MBTI는 ${studentMbti}입니다.
                당신의 역할은 정답을 직접 알려주는 것이 아니라, 학생이 스스로 문제를 해결하도록 돕는 것입니다.
                다음 규칙을 반드시 지켜주세요:
                1. 절대로 문제의 최종 정답을 말하지 마세요.
                2. 학생의 질문에 대해, 문제를 해결하기 위해 어떤 개념을 알아야 하는지, 혹은 어떤 순서로 접근하면 좋을지 단계별로 안내해주세요.
                3. 친절하고 격려하는 말투를 사용하며, 학생의 MBTI(${studentMbti}) 성향을 고려하여 소통해주세요.
                4. 어려운 용어는 초등학생 눈높이에 맞춰 쉽게 설명해주세요.

                학생의 질문: "${prompt}"
            `;
        } else {
            // Existing prompts
             switch (activeTab) {
                case 'qa': fullPrompt = `다음 질문에 대해 자세히 답변해줘: ${prompt}`; break;
                case 'summary': fullPrompt = `다음 텍스트를 핵심만 간추려 요약해줘: ${prompt}`; break;
                case 'quiz': fullPrompt = `다음 내용이나 주제를 바탕으로 객관식 퀴즈 3개를 만들어줘. 각 질문 뒤에 정답도 알려줘: ${prompt}`; break;
                case 'image': fullPrompt = `이 이미지에 대해 다음 질문에 답변해줘: ${prompt}`; break;
                default: fullPrompt = prompt; break;
            }
        }

        const payload = { contents: [{ role: "user", parts: [{ text: fullPrompt }] }] };
        if (activeTab === 'image' && imageBase64) {
            payload.contents[0].parts.push({ inlineData: { mimeType: imageFile.type, data: imageBase64 } });
        }
        
        const apiKey = ""; // Leave empty
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        try {
            const apiResponse = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (!apiResponse.ok) throw new Error(`API 요청 실패: ${apiResponse.statusText}`);
            const result = await apiResponse.json();
            const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text || "유효한 응답을 받지 못했습니다.";
            setResponse(generatedText);
            
            if (db && userId) {
                const historyCollectionPath = `/artifacts/${appId}/users/${userId}/studyHistory`;
                await addDoc(collection(db, historyCollectionPath), {
                    type: activeTab,
                    prompt: prompt,
                    response: generatedText,
                    mbti: studentMbti || null,
                    timestamp: serverTimestamp()
                });
            }
        } catch (err) {
            console.error("API call error:", err);
            setError(`AI 응답 생성 중 오류가 발생했습니다: ${err.message}`);
        } finally {
            setIsLoading(false);
            setPrompt('');
            setImageFile(null);
            setImageBase64(null);
            if(fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const renderTabContent = () => {
        const placeholderText = {
            mentor: "AI 멘토에게 해결하고 싶은 문제를 질문해보세요! 예: '분수는 왜 필요한가요?'",
            qa: "무엇이든 물어보세요! 예: '조선 시대의 세종대왕 업적은?'",
            summary: "요약할 텍스트를 여기에 붙여넣으세요.",
            quiz: "퀴즈를 만들고 싶은 주제나 내용을 입력하세요. 예: '광합성'",
            image: "이미지에 대해 질문할 내용을 입력하세요."
        };

        return (
            <div className="flex-grow flex flex-col p-4 md:p-6 bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200">
                <textarea
                    className="w-full flex-grow p-4 text-gray-700 bg-gray-50 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition duration-200 resize-none"
                    placeholder={placeholderText[activeTab]}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={activeTab === 'image' ? 2 : 5}
                />
                {activeTab === 'image' && (
                    <div className="mt-4">
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageChange}
                            ref={fileInputRef}
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current.click()}
                            className="w-full p-3 text-center bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition duration-200 flex items-center justify-center"
                        >
                            <Camera className="mr-2 h-5 w-5" />
                            {imageFile ? `${imageFile.name} 선택됨` : '이미지 선택'}
                        </button>
                        {imageBase64 && (
                            <div className="mt-4 p-2 border rounded-lg bg-gray-100">
                                <img src={`data:${imageFile.type};base64,${imageBase64}`} alt="Preview" className="max-h-40 mx-auto rounded-md" />
                            </div>
                        )}
                    </div>
                )}
                <button
                    onClick={getAiResponse}
                    disabled={isLoading}
                    className="mt-4 w-full p-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center font-semibold text-lg"
                >
                    {isLoading ? <Loader2 className="animate-spin mr-2" /> : (activeTab === 'mentor' ? <GraduationCap className="mr-2" /> : <Send className="mr-2" />)}
                    {activeTab === 'mentor' ? '멘토링 요청하기' : 'AI에게 요청하기'}
                </button>
            </div>
        );
    };
    
    const TabButton = ({ id, label, icon }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`flex-1 p-3 md:p-4 text-sm md:text-base font-medium rounded-xl transition-all duration-300 flex flex-col md:flex-row items-center justify-center gap-2 ${
                activeTab === id ? 'bg-blue-600 text-white shadow-lg' : 'bg-white/60 text-gray-700 hover:bg-white/90 hover:shadow-md'
            }`}
        >
            {icon}
            <span>{label}</span>
        </button>
    );

    return (
        <div className="min-h-screen w-full bg-gradient-to-br from-blue-50 to-indigo-100 font-sans flex flex-col md:flex-row p-4 gap-4">
            {showMbtiModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-2xl p-6 md:p-8 w-full max-w-md">
                        <h2 className="text-2xl font-bold text-gray-800 mb-2">AI 멘토링 시작하기</h2>
                        <p className="text-gray-600 mb-6">정확한 멘토링을 위해 학생의 MBTI를 선택해주세요.</p>
                        <div className="grid grid-cols-4 gap-2">
                            {mbtiTypes.map(mbti => (
                                <button key={mbti} onClick={() => handleMbtiSelect(mbti)} className="p-3 bg-gray-100 rounded-lg font-mono font-bold text-gray-700 hover:bg-blue-500 hover:text-white transition-all duration-200">
                                    {mbti}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="flex-1 flex flex-col gap-4">
                 <header className="text-center md:text-left">
                    <h1 className="text-3xl md:text-4xl font-bold text-gray-800 flex items-center justify-center md:justify-start gap-3">
                        <BrainCircuit className="h-10 w-10 text-blue-500" />
                        AI 성장형 학습 멘토
                    </h1>
                     <p className="text-gray-600 mt-1">AI 멘토와 함께 잠재력을 발견하고 성장하세요.</p>
                </header>
                
                {userId && (
                    <div className="bg-white/50 p-2 rounded-lg text-xs text-gray-600 flex items-center justify-center gap-4">
                        <div className="flex items-center gap-2">
                            <User className="h-4 w-4" /> <span>사용자 ID: {userId}</span>
                        </div>
                        {studentMbti && (
                            <div className="flex items-center gap-2 font-bold text-blue-600">
                                <span>MBTI: {studentMbti}</span>
                                <button onClick={() => setShowMbtiModal(true)} className="text-xs text-gray-500 hover:text-blue-500">(변경)</button>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex flex-wrap gap-2 md:gap-4 p-2 bg-white/50 rounded-2xl shadow-sm">
                    <TabButton id="mentor" label="AI 멘토링" icon={<GraduationCap />} />
                    <TabButton id="qa" label="질문하기" icon={<HelpCircle />} />
                    <TabButton id="summary" label="요약하기" icon={<BookText />} />
                    <TabButton id="quiz" label="퀴즈 만들기" icon={<FileQuestion />} />
                    <TabButton id="image" label="이미지로 질문" icon={<Camera />} />
                </div>

                <div className="flex-grow flex flex-col gap-4">
                    {renderTabContent()}
                    <div className="p-4 md:p-6 bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200 min-h-[200px] flex flex-col">
                        <h3 className="text-lg font-semibold text-gray-700 mb-3">AI 응답</h3>
                        {isLoading && <div className="flex-grow flex items-center justify-center text-gray-500"><Loader2 className="animate-spin h-8 w-8" /></div>}
                        {error && <div className="text-red-500 bg-red-100 p-3 rounded-lg">{error}</div>}
                        {response && <div className="prose prose-sm max-w-none text-gray-800 whitespace-pre-wrap overflow-y-auto">{response}</div>}
                        {!isLoading && !response && !error && <div className="flex-grow flex items-center justify-center text-gray-400"><p>AI의 답변이 여기에 표시됩니다.</p></div>}
                    </div>
                </div>
            </main>

            {/* History Sidebar */}
            <aside className="w-full md:w-80 lg:w-96 flex-shrink-0 bg-white/60 backdrop-blur-sm rounded-2xl shadow-lg border border-gray-200 flex flex-col">
                <h2 className="text-xl font-bold text-gray-800 p-4 border-b border-gray-200 flex items-center gap-2"><History className="h-6 w-6 text-blue-500"/>학습 기록</h2>
                <div className="flex-grow overflow-y-auto p-2">
                    {history.length > 0 ? (
                        history.map(item => (
                            <div key={item.id} className="mb-2 p-3 bg-white rounded-lg shadow-sm hover:bg-blue-50 transition cursor-pointer" onClick={() => { setResponse(item.response); setPrompt(item.prompt); setActiveTab(item.type)}}>
                                <p className="font-semibold text-sm text-blue-700 capitalize flex items-center gap-1.5">
                                    {item.type === 'mentor' && <GraduationCap size={14}/>}
                                    {item.type === 'qa' && <HelpCircle size={14}/>}
                                    {item.type === 'summary' && <BookText size={14}/>}
                                    {item.type === 'quiz' && <FileQuestion size={14}/>}
                                    {item.type === 'image' && <Camera size={14}/>}
                                    {item.type} {item.mbti && `(${item.mbti})`}
                                </p>
                                <p className="text-sm text-gray-600 truncate mt-1">{item.prompt || '이미지 질문'}</p>
                                <p className="text-xs text-gray-400 mt-1 text-right">{item.timestamp ? new Date(item.timestamp.toDate()).toLocaleString('ko-KR') : ''}</p>
                            </div>
                        ))
                    ) : (
                        <div className="text-center text-gray-500 p-8"><p>아직 학습 기록이 없습니다.</p></div>
                    )}
                </div>
            </aside>
        </div>
    );
}
