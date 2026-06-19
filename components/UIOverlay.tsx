/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useRef, useState } from 'react';
import { Rnd } from 'react-rnd';
import { BuildingType, CityStats, NewsItem, BuildingCategory } from '../types';
import { BUILDINGS } from '../constants';
import { Maximize2, Minimize2, X, AlertCircle, ShoppingBag, Tv, Zap, Check, ChevronUp, ChevronDown, Settings } from 'lucide-react';

interface UIOverlayProps {
  stats: CityStats;
  selectedTool: BuildingType | null;
  onSelectTool: (type: BuildingType | null) => void;
  newsFeed: NewsItem[];
  onAdReward: (reward: string) => void;
  setStats: React.Dispatch<React.SetStateAction<CityStats>>;
}

const CATEGORIES = [
  { id: BuildingCategory.Infrastructure, name: 'Дороги и Земля' },
  { id: BuildingCategory.Residential, name: 'Жилье' },
  { id: BuildingCategory.Commercial, name: 'Коммерция' },
  { id: BuildingCategory.Industrial, name: 'Промышленность' },
  { id: BuildingCategory.Decorations, name: 'Благоустройство' }
];

const ToolButton: React.FC<{
  type: BuildingType;
  isSelected: boolean;
  onClick: () => void;
  money: number;
  level: number;
  setToastMsg: (msg: string) => void;
  dynamicCost?: number;
}> = ({ type, isSelected, onClick, money, level, setToastMsg, dynamicCost }) => {
  const config = BUILDINGS[type];
  const actualCost = dynamicCost !== undefined ? dynamicCost : config.cost;
  const canAfford = money >= actualCost;
  const isBulldoze = type === BuildingType.None;
  const isLocked = !isBulldoze && config.minLevel > level;
  
  const bgColor = isBulldoze ? config.color : config.color;

  const handleClick = () => {
    if (isLocked) {
      setToastMsg(`Доступно на ${config.minLevel} уровне`);
      return;
    }
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      disabled={(!isBulldoze && !canAfford) && !isLocked}
      className={`
        relative flex flex-col items-center justify-center rounded-lg border-2 transition-all shadow-lg backdrop-blur-sm flex-shrink-0
        w-14 h-14 md:w-16 md:h-16 overflow-hidden
        ${isSelected ? 'border-white bg-white/20 scale-110 z-10' : 'border-gray-600 bg-gray-900/80 hover:bg-gray-800'}
        ${!isBulldoze && !canAfford && !isLocked ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      title={isLocked ? `Заблокировано до ур. ${config.minLevel}` : config.description}
    >
      <div className="w-6 h-6 md:w-8 md:h-8 rounded mb-0.5 md:mb-1 border border-black/30 shadow-inner flex items-center justify-center overflow-hidden" style={{ backgroundColor: isBulldoze ? 'transparent' : bgColor }}>
        {isBulldoze && <div className="w-full h-full bg-red-600 text-white flex justify-center items-center font-bold text-base md:text-lg">✕</div>}
        {type === BuildingType.Road && <div className="w-full h-2 bg-gray-800 transform -rotate-45"></div>}
      </div>
      <span className="text-[8px] md:text-[10px] font-bold text-white uppercase tracking-wider drop-shadow-md leading-none truncate max-w-full px-1">{config.name}</span>
      {actualCost > 0 && !isLocked && (
        <span className={`text-[8px] md:text-[10px] font-mono leading-none ${canAfford ? 'text-green-300' : 'text-red-400'}`}>${actualCost}</span>
      )}
      
      {isLocked && (
        <div className="absolute inset-0 bg-red-900/60 backdrop-blur-[2px] flex items-center justify-center z-20">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/80 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
      )}
    </button>
  );
};

const UIOverlay: React.FC<UIOverlayProps & { dynamicCosts?: Record<string, number>; moneyError?: boolean; }> = ({
  stats,
  selectedTool,
  onSelectTool,
  newsFeed,
  onAdReward,
  setStats,
  dynamicCosts,
  moneyError
}) => {
  const newsRef = useRef<HTMLDivElement>(null);
  
  const [upgradesVisible, setUpgradesVisible] = useState(false);
  const [newsVisible, setNewsVisible] = useState(true);
  const [newsMinimized, setNewsMinimized] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [adPopupVisible, setAdPopupVisible] = useState(false);
  const [volume, setVolume] = useState(50);
  const [sfxVolume, setSfxVolume] = useState(50);
  const [newsZ, setNewsZ] = useState(10);
  const [activeCategory, setActiveCategory] = useState<BuildingCategory>(BuildingCategory.Infrastructure);
  const [toolbarExpanded, setToolbarExpanded] = useState(true);
  const [tutorialStep, setTutorialStep] = useState(stats.tutorialCompleted ? 0 : 1);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    if (toastMsg) {
      const t = setTimeout(() => setToastMsg(null), 2500);
      return () => clearTimeout(t);
    }
  }, [toastMsg]);

  const completeTutorial = () => {
     setTutorialStep(0);
     setStats(prev => ({ ...prev, tutorialCompleted: true }));
  };

  // Expose these via window events so App or IsoMap can trigger them
  useEffect(() => {
    const handleToggleSettings = () => setSettingsVisible(v => !v);
    const handleTriggerAd = () => {
       if (!adPopupVisible && !upgradesVisible && !settingsVisible) {
          setAdPopupVisible(true);
       }
    };
    
    window.addEventListener('toggle-settings', handleToggleSettings);
    window.addEventListener('trigger-ad-popup', handleTriggerAd);
    return () => {
       window.removeEventListener('toggle-settings', handleToggleSettings);
       window.removeEventListener('trigger-ad-popup', handleTriggerAd);
    };
  }, [adPopupVisible, upgradesVisible, settingsVisible]);

  const performUpgrade = (type: 'tax' | 'road' | 'park', cost: number) => {
    if (stats.money >= cost) {
       setStats(prev => {
          let ups = {...prev.upgrades};
          if (type==='tax') ups.taxBoost += 0.1;
          if (type==='road') ups.roadDiscount += 0.2;
          if (type==='park') ups.parkBoost += 5;
          return { ...prev, money: prev.money - cost, upgrades: ups };
       });
    }
  };

  useEffect(() => {
    if (newsRef.current) {
      newsRef.current.scrollTop = newsRef.current.scrollHeight;
    }
  }, [newsFeed, newsMinimized]);

  // Derive tools for active category
  const activeTools = Object.values(BUILDINGS)
     .filter(b => b.category === activeCategory)
     .map(b => b.type);

  return (
    <div className="absolute inset-0 pointer-events-none p-2 md:p-4 font-sans z-10 overflow-hidden">
      
      {/* Top Left Stats (Fixed) */}
      <div className="absolute top-4 left-4 pointer-events-auto flex flex-col gap-2">
        <div className="bg-gray-900/90 text-white p-2 md:p-3 rounded-xl border border-gray-700 shadow-2xl backdrop-blur-md flex gap-3 md:gap-6 items-center w-full md:w-auto">
          <div className={`flex flex-col ${moneyError ? 'animate-money-error' : ''}`}>
            <span className="text-[8px] md:text-[10px] text-gray-400 uppercase font-bold tracking-widest">Казна</span>
            <span className={`text-lg md:text-2xl font-black font-mono drop-shadow-md transition-colors ${moneyError ? 'text-red-500' : 'text-green-400'}`}>${Math.floor(stats.money).toLocaleString()}</span>
          </div>
          <div className="w-px h-6 md:h-8 bg-gray-700"></div>
          <div className="flex flex-col">
            <span className="text-[8px] md:text-[10px] text-gray-400 uppercase font-bold tracking-widest">Жители ({stats.level} ур.)</span>
            <span className="text-base md:text-xl font-bold text-blue-300 font-mono drop-shadow-md">{stats.population.toLocaleString()}</span>
          </div>
          <div className="w-px h-6 md:h-8 bg-gray-700"></div>
          <div className="flex flex-col items-center">
             <span className="text-[8px] md:text-[10px] text-gray-400 uppercase font-bold tracking-widest">Счастье</span>
             <span className={`text-base md:text-lg font-bold font-mono ${stats.happiness > 70 ? 'text-green-400' : stats.happiness < 40 ? 'text-red-400' : 'text-yellow-400'}`}>{Math.floor(stats.happiness)}%</span>
          </div>
          <div className="w-px h-6 md:h-8 bg-gray-700"></div>
          <div className="flex flex-col items-end">
             <span className="text-[8px] md:text-[10px] text-gray-400 uppercase font-bold tracking-widest">День</span>
             <span className="text-base md:text-lg font-bold text-white font-mono">{stats.day}</span>
          </div>
        </div>
        
        {/* Buttons */}
        <div className="flex gap-2">
           <button onClick={() => setUpgradesVisible(true)} className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold py-2 px-4 rounded-xl shadow-lg flex items-center justify-center gap-2 border border-purple-400/50 transition-transform active:scale-95 text-xs">
              <ShoppingBag size={14} /> Улучшения
           </button>
        </div>
      </div>

      {/* Tutorial Modal */}
      {tutorialStep > 0 && (
         <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center animate-fade-in backdrop-blur-sm pointer-events-auto">
           <div className="bg-slate-900 border border-indigo-500/50 p-6 rounded-2xl shadow-2xl max-w-sm w-full mx-4 text-center">
             <div className="mb-4 flex justify-center">
                <div className="bg-indigo-500 p-3 rounded-full shadow-lg shadow-indigo-500/30">
                  <Check className="text-white" size={32} />
                </div>
             </div>
             
             {tutorialStep === 1 && (
               <>
                 <h2 className="text-xl font-black text-white mb-2">Добро пожаловать, Мэр!</h2>
                 <p className="text-sm text-slate-300 mb-6">Это ваш новый участок земли. Здесь вы построите огромный мегаполис! Готовы начать?</p>
                 <button onClick={() => setTutorialStep(2)} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl text-sm shadow-md transition-all active:scale-95">Далее</button>
               </>
             )}
             
             {tutorialStep === 2 && (
               <>
                 <h2 className="text-xl font-black text-white mb-2">Время - деньги</h2>
                 <p className="text-sm text-slate-300 mb-6">Каждый день (каждые пару секунд реального времени) город живет: собираются налоги, а также приезжают новые жители.</p>
                 <button onClick={() => setTutorialStep(3)} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl text-sm shadow-md transition-all active:scale-95">Понятно</button>
               </>
             )}
             
             {tutorialStep === 3 && (
               <>
                 <h2 className="text-xl font-black text-white mb-2">Экономика и Здания</h2>
                 <div className="text-sm text-slate-300 mb-6 text-left space-y-3">
                   <p><strong className="text-red-400">Жилые дома</strong>: увеличивают население. Больше людей = больше налогов каждый день!</p>
                   <p><strong className="text-blue-400">Магазины</strong>: стабильно приносят деньги и не вредят городу.</p>
                   <p><strong className="text-yellow-400">Фабрики</strong>: очень прибыльны, но <strong>снижают счастье жителей</strong>, если построены ближе 4 клеток к домам. Выносите промзоны за город!</p>
                 </div>
                 <button onClick={() => setTutorialStep(4)} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-xl text-sm shadow-md transition-all active:scale-95">Далее</button>
               </>
             )}
             
             {tutorialStep === 4 && (
               <>
                 <h2 className="text-xl font-black text-white mb-2">Индикаторы</h2>
                 <p className="text-sm text-slate-300 mb-6">Следите за <strong>Счастьем</strong>! Если оно упадет, жители перестанут к вам переезжать. Повышайте счастье, строя парки. Если не хватает места — покупайте новые кварталы!</p>
                 <button onClick={completeTutorial} className="w-full bg-green-500 hover:bg-green-400 text-white font-black py-3 rounded-xl text-sm shadow-[0_0_15px_rgba(34,197,94,0.4)] transition-all active:scale-95 text-xl">Начать строить</button>
               </>
             )}
             
             {/* Progress dots */}
             <div className="flex justify-center gap-2 mt-6">
                {[1,2,3,4].map(step => (
                   <div key={step} className={`w-2 h-2 rounded-full ${tutorialStep === step ? 'bg-indigo-400' : 'bg-slate-700'}`}></div>
                ))}
             </div>
           </div>
         </div>
      )}

      {/* Upgrades Modal */}
      {upgradesVisible && (
        <div className="absolute inset-0 bg-black/60 z-[100] flex items-center justify-center animate-fade-in backdrop-blur-sm pointer-events-auto">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl shadow-2xl max-w-lg w-full mx-4">
            <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-2">
               <h2 className="text-2xl font-black text-white flex items-center gap-2"><ShoppingBag className="text-purple-400"/> Исследования и Бусты</h2>
               <button onClick={() => setUpgradesVisible(false)} className="text-slate-400 hover:text-white"><X /></button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-white text-sm">Налоги +10%</h3>
                    <p className="text-xs text-slate-400 mt-1">Доход от всех зданий увеличивается навсегда.</p>
                  </div>
                  <button onClick={() => performUpgrade('tax', 1000 + (stats.upgrades.taxBoost*10000))} disabled={stats.money < 1000 + (stats.upgrades.taxBoost*10000)} className="mt-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:bg-slate-700 text-white text-xs py-2 rounded-lg font-bold">
                    Купить за ${1000 + (stats.upgrades.taxBoost*10000)}
                  </button>
               </div>
               
               <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold text-white text-sm">Дешевые дороги (-20%)</h3>
                    <p className="text-xs text-slate-400 mt-1">Снижает стоимость строительства дорог.</p>
                  </div>
                  <button onClick={() => performUpgrade('road', 500 + (stats.upgrades.roadDiscount*5000))} disabled={stats.money < 500 + (stats.upgrades.roadDiscount*5000) || stats.upgrades.roadDiscount >= 0.8} className="mt-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:bg-slate-700 text-white text-xs py-2 rounded-lg font-bold">
                    {stats.upgrades.roadDiscount >= 0.8 ? 'Максимум' : `Купить за $${500 + (stats.upgrades.roadDiscount*5000)}`}
                  </button>
               </div>
               
               {/* Monetization / AD blocks */}
               <div className="bg-slate-800/80 p-4 rounded-xl border border-green-700/50 flex flex-col justify-between col-span-1 md:col-span-2 relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-green-600 text-[9px] uppercase font-bold px-2 py-0.5 rounded-bl-lg text-white">Реклама</div>
                  <div className="flex items-center gap-3 relative z-10">
                     <div className="bg-black/30 p-2 rounded-lg"><Tv className="text-green-400" size={24} /></div>
                     <div>
                       <h3 className="font-bold text-white text-sm">Грант от спонсоров</h3>
                       <p className="text-xs text-slate-400">Посмотрите небольшой ролик, чтобы получить $5000 в казну моментально.</p>
                     </div>
                  </div>
                  <button onClick={() => { onAdReward('$5000'); setUpgradesVisible(false); }} className="mt-4 bg-green-600 hover:bg-green-500 text-white text-xs py-2 rounded-lg font-bold shadow-lg shadow-green-900/50">
                    Смотреть рекламу
                  </button>
               </div>
               
               <div className="bg-slate-800/80 p-4 rounded-xl border border-yellow-700/50 flex flex-col justify-between col-span-1 md:col-span-2 relative overflow-hidden">
                   <div className="absolute top-0 right-0 bg-yellow-600 text-[9px] uppercase font-bold px-2 py-0.5 rounded-bl-lg text-white">Реклама</div>
                   <div className="flex items-center gap-3 relative z-10">
                     <div className="bg-black/30 p-2 rounded-lg"><Zap className="text-yellow-400" size={24} /></div>
                     <div>
                       <h3 className="font-bold text-white text-sm">Золотая Лихорадка!</h3>
                       <p className="text-xs text-slate-400">Удвойте весь доход города на 3 минуты.</p>
                     </div>
                  </div>
                  <button onClick={() => { onAdReward('TAX_BOOST'); setUpgradesVisible(false); }} disabled={stats.upgrades.taxBoost > 0.5} className="mt-4 bg-yellow-600 hover:bg-yellow-500 text-white text-xs py-2 rounded-lg font-bold shadow-lg shadow-yellow-900/50 disabled:opacity-50">
                    Активировать
                  </button>
               </div>
            </div>
          </div>
        </div>
      )}

      {/* Ad Popup Trigger Modal */}
      {adPopupVisible && (
        <div id="ad-popup-container" className="absolute top-24 right-4 pointer-events-auto animate-bounce z-40">
           <div className="bg-gradient-to-br from-yellow-500 to-orange-600 p-4 rounded-2xl shadow-[0_0_20px_rgba(234,179,8,0.4)] border border-yellow-300 w-64">
              <button onClick={() => setAdPopupVisible(false)} className="absolute top-1 right-1 text-yellow-100 hover:text-white"><X size={16}/></button>
              <div className="flex gap-3 items-center">
                 <div className="bg-white/20 p-2 rounded-full"><Zap className="text-yellow-100" /></div>
                 <div>
                    <h3 className="text-white font-bold text-sm leading-tight">Спонсорская помощь!</h3>
                    <p className="text-yellow-100 text-[10px] mt-1 leading-tight">Посмотрите видео, чтобы получить солидный буст.</p>
                 </div>
              </div>
              <button onClick={() => { setAdPopupVisible(false); setUpgradesVisible(true); }} className="w-full mt-3 bg-white text-orange-600 hover:bg-yellow-50 font-bold py-1.5 rounded-lg text-xs shadow-md">
                 Открыть Улучшения
              </button>
           </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsVisible && (
        <div className="absolute inset-0 bg-black/60 z-[100] flex items-center justify-center animate-fade-in backdrop-blur-sm pointer-events-auto">
           <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl shadow-2xl max-w-xs w-full mx-4">
              <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-2">
                 <h2 className="text-xl font-black text-white flex items-center gap-2"><Settings className="text-gray-400" size={20}/> Настройки</h2>
                 <button onClick={() => setSettingsVisible(false)} className="text-slate-400 hover:text-white"><X /></button>
              </div>
              <div className="space-y-6">
                 <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Громкость музыки ({volume}%)</label>
                    <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-full accent-indigo-500" />
                 </div>
                 <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-2">Звуковые эффекты ({sfxVolume}%)</label>
                    <input type="range" min="0" max="100" value={sfxVolume} onChange={(e) => setSfxVolume(Number(e.target.value))} className="w-full accent-indigo-500" />
                 </div>
                 
                 <div className="pt-4 border-t border-slate-800">
                    <button onClick={() => { localStorage.removeItem('polycity_save'); window.location.reload(); }} className="w-full border border-red-500/50 hover:bg-red-500/20 text-red-400 font-bold py-2 rounded-xl text-sm transition-colors">
                       Сбросить прогресс
                    </button>
                    <p className="text-[10px] text-center text-slate-500 mt-2">Осторожно, это удалит весь ваш город!</p>
                 </div>
              </div>
              <button onClick={() => setSettingsVisible(false)} className="w-full mt-6 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 rounded-xl text-sm">
                 Закрыть
              </button>
           </div>
        </div>
      )}

      {/* Recover Windows Button */}
      {(!newsVisible) && (
        <div className="absolute top-28 left-4 flex flex-col gap-2 pointer-events-auto">
          {!newsVisible && (
            <button onClick={() => setNewsVisible(true)} className="bg-gray-800 hover:bg-gray-700 text-white text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-1 border border-gray-600 transition-colors">
              <AlertCircle size={14} /> Открыть Новости
            </button>
          )}
        </div>
      )}

      {/* News Feed Panel */}
      {newsVisible && (
        <Rnd
          default={{
            x: window.innerWidth > 768 ? window.innerWidth - 340 : 16,
            y: window.innerWidth > 768 ? window.innerHeight - 250 : window.innerHeight - 350,
            width: 320,
            height: newsMinimized ? 40 : 200,
          }}
          minWidth={250}
          minHeight={newsMinimized ? 40 : 150}
          bounds="parent"
          dragHandleClassName="handle-news"
          onMouseDown={() => { setNewsZ(20); }}
          className="pointer-events-auto shadow-2xl"
          style={{ zIndex: newsZ }}
        >
          <div className="w-full h-full bg-black/80 text-white rounded-xl border border-gray-700/80 backdrop-blur-xl flex flex-col overflow-hidden relative">
            <div className="handle-news cursor-move bg-gray-800/90 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-gray-300 border-b border-gray-600 flex justify-between items-center select-none">
              <div className="flex items-center gap-2">
                 <span>Новости</span>
              </div>
              <div className="flex items-center gap-2">
                <button onPointerDown={(e)=>{e.stopPropagation(); setNewsMinimized(!newsMinimized);}} className="hover:bg-white/20 p-1 rounded transition-colors text-white z-50">
                   {newsMinimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
                </button>
                <button onPointerDown={(e)=>{e.stopPropagation(); setNewsVisible(false);}} className="hover:bg-red-500/50 p-1 rounded transition-colors text-white z-50">
                   <X size={12} />
                </button>
              </div>
            </div>
            
            {!newsMinimized && (
              <>
                <div className="absolute top-8 left-0 right-0 pointer-events-none bg-[linear-gradient(to_bottom,rgba(255,255,255,0)_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px] opacity-30 z-20 flex-1"></div>
                
                <div ref={newsRef} className="flex-1 overflow-y-auto p-2 md:p-3 space-y-2 text-[10px] md:text-xs font-mono scroll-smooth mask-image-b z-10 custom-scrollbar">
                  {newsFeed.length === 0 && <div className="text-gray-500 italic text-center mt-10">Нет активных новостей.</div>}
                  {newsFeed.map((news) => (
                    <div key={news.id} className={`
                      border-l-2 pl-2 py-1 transition-all animate-fade-in leading-tight relative pr-10
                      ${news.type === 'positive' ? 'border-green-500 text-green-200 bg-green-900/20' : ''}
                      ${news.type === 'negative' ? 'border-red-500 text-red-200 bg-red-900/20' : ''}
                      ${news.type === 'neutral' ? 'border-blue-400 text-blue-100 bg-blue-900/20' : ''}
                    `}>
                      <span className="opacity-70 text-[8px] absolute top-1 right-1">{new Date(Number(news.id.split('.')[0])).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      {news.text}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Rnd>
      )}

      {/* Global Cancel Tool Button */}
      {selectedTool !== null && (
        <div className="absolute bottom-[110px] md:bottom-4 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-4 z-50 pointer-events-auto mb-safe transition-all animate-fade-in">
          <button 
            onClick={() => onSelectTool(null)} 
            className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2 md:px-4 md:py-3 rounded-2xl shadow-[0_0_20px_rgba(220,38,38,0.8)] border-2 border-red-400 backdrop-blur-md font-bold text-sm"
          >
            <X size={18} />
            <span>Отменить выбор</span>
          </button>
        </div>
      )}

      {/* Bottom Center Toolbar (Fixed) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-auto flex flex-col items-center mb-safe">
        
        {/* Category Tabs */}
        {toolbarExpanded && (
          <div className="flex gap-1 md:gap-2 mb-2 bg-gray-900/90 py-1 px-2 rounded-full border border-gray-700 backdrop-blur-md shadow-lg max-w-[90vw] overflow-x-auto custom-scrollbar">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`text-[10px] md:text-xs font-bold px-3 py-1.5 rounded-full transition-colors whitespace-nowrap ${activeCategory === cat.id ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {/* Selected Category Buildings */}
        <div className="flex bg-gray-900/90 p-1 md:p-2 rounded-2xl border border-gray-600/50 backdrop-blur-xl shadow-2xl relative">
          
          {/* Collapse/Expand Toggle */}
          <button 
             onClick={() => setToolbarExpanded(!toolbarExpanded)}
             className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-600 rounded-full p-0.5 text-gray-400 hover:text-white shadow-md z-20"
          >
             {toolbarExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>

          {toolbarExpanded ? (
            <div className="flex gap-1 md:gap-2 px-1 max-w-[90vw] overflow-x-auto custom-scrollbar py-2">
              {activeTools.map((type) => (
                <ToolButton
                  key={type}
                  type={type}
                  isSelected={selectedTool === type}
                  onClick={() => onSelectTool(selectedTool === type ? null : type)}
                  money={stats.money}
                  level={stats.level}
                  setToastMsg={setToastMsg}
                  dynamicCost={dynamicCosts?.[type]}
                />
              ))}
            </div>
          ) : (
             <div className="px-6 py-1 text-[10px] font-bold text-gray-400 tracking-widest uppercase">Стройка свернута</div>
          )}
        </div>
      </div>
      
      {/* Footer info & Settings btn */}
      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2 pointer-events-auto mb-safe">
        <button onClick={() => window.dispatchEvent(new CustomEvent('toggle-settings'))} className="bg-gray-800 hover:bg-gray-700 text-white p-2 rounded-xl shadow-lg border border-gray-600 transition-colors">
          <Settings size={18} />
        </button>
        <div className="text-[8px] md:text-[9px] text-white/30 font-mono text-right hover:text-white/60 transition-colors">
          <a href="https://x.com/ammaar" target="_blank" rel="noreferrer">Создано @ammaar</a>
        </div>
      </div>
    </div>
  );
};

export default UIOverlay;