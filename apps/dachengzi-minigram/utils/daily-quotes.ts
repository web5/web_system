/**
 * 今日一句 · 精选中英文语句快照（随包静态数据，非接口方案）
 *
 * ── 来源 ──────────────────────────────────────────────────
 * 来源：chase 个人工作空间/30-任务产物/2026-11-05-新概念英语学习站点/data/lessons.json
 * 来源无 git 仓库，以 sha256 前 16 位钉死版本：sha16 40339154ec0a54ad
 * （完整绝对路径见 utils/nce-quotes.ts 头注与 136 号回执；此处省略工作目录段以保前端中性）
 * 书目范围：book=NCE2 / 96 课 / 1601 条 en&&cn 配对。
 *
 * ── 选句规则 ──────────────────────────────────────────────
 * 从上述真实句池中人工筛选出优美、语义完整（非逗号/分号结尾叙事半句）、
 * 可摘抄的中英成对语句，逐字取自原文，不改写、不编造。
 * 本快照为真实课文语句的筛选子集；全量 1601 条快照见 utils/nce-quotes.ts
 * （保留作溯源底稿，退出显示层）。
 *
 * ── 顺序与出处 ────────────────────────────────────────────
 * 按 lessonId 升序 + 原行 lineIndex 排列，确定性、不随机打乱。
 * source 附 book/lessonId/title/lineIndex，为溯源锚点，不在 UI 展示
 * （getDailyQuote() 恒返回 { cn, en } 两字段）。
 *
 * ── 版权（如实登记，不代拍） ──────────────────────────────
 * 教材内容仅供个人学习，不对外分发。派生语句为 NCE 原文筛选 / 提炼，供个人学习。
 * 正式上架 / 商用前须另行确认 NCE 教材与译文的授权范围（风险归用户承担）。
 */

export type SelectedQuoteSource = {
  book: string;
  lessonId: number;
  title: string;
  lineIndex: number;
};

export type SelectedQuote = {
  cn: string;
  en: string;
  /** 出处锚点，仅供离线校验同句配对，不在 UI 展示 */
  source: SelectedQuoteSource;
};

/** 精选语句池（构建期随包落盘的静态常量；运行时只读消费） */
export const DAILY_QUOTES: SelectedQuote[] = [
  { cn: "我从不在星期天早起。", en: "I never get up early on Sundays.", source: { book: "NCE2", lessonId: 2, title: "Breakfast or Lunch", lineIndex: 1 } },
  { cn: "我有时会一直睡到午饭时间。", en: "I sometimes stay in bed until lunchtime.", source: { book: "NCE2", lessonId: 2, title: "Breakfast or Lunch", lineIndex: 2 } },
  { cn: "明信片总是破坏我的假期。", en: "Postcards always spoil my holidays.", source: { book: "NCE2", lessonId: 3, title: "Please Send Me a Card", lineIndex: 0 } },
  { cn: "在最后一天，我做了一个重要的决定。", en: "On the last day, I made a big decision.", source: { book: "NCE2", lessonId: 3, title: "Please Send Me a Card", lineIndex: 8 } },
  { cn: "我在房间里呆了一整天，但一张明信片也没写。", en: "I spent the whole day in my room, but I did not write a single card.", source: { book: "NCE2", lessonId: 3, title: "Please Send Me a Card", lineIndex: 10 } },
  { cn: "我哥哥以前从未出国过，所以他觉得这次旅行非常激动人心。", en: "My brother has never been abroad before, so he is finding this trip very exciting.", source: { book: "NCE2", lessonId: 4, title: "An Exciting Trip", lineIndex: 9 } },
  { cn: "这只鸟在三分钟内飞完了这段距离。", en: "The bird covered the distance in three minutes.", source: { book: "NCE2", lessonId: 5, title: "No Wrong Numbers", lineIndex: 6 } },
  { cn: "这样一来，他就开通了自己的私人电话服务。", en: "In this way, he has begun his own private telephone service.", source: { book: "NCE2", lessonId: 5, title: "No Wrong Numbers", lineIndex: 8 } },
  { cn: "人人都认识他。", en: "Everybody knows him.", source: { book: "NCE2", lessonId: 6, title: "Percy Buttons", lineIndex: 9 } },
  { cn: "乔·桑德斯拥有我们镇上最美丽的花园。", en: "Joe Saunders has the most beautiful garden in our town.", source: { book: "NCE2", lessonId: 8, title: "The Best and the Worst", lineIndex: 0 } },
  { cn: "它已经属于我们家很长时间了。", en: "It has belonged to our family for a long time.", source: { book: "NCE2", lessonId: 10, title: "Not for Jazz", lineIndex: 4 } },
  { cn: "现在我们不被允许碰它。", en: "Now we are not allowed to touch it.", source: { book: "NCE2", lessonId: 10, title: "Not for Jazz", lineIndex: 10 } },
  { cn: "他从没向我借过钱。", en: "He has never borrowed money from me.", source: { book: "NCE2", lessonId: 11, title: "One Good Turn Deserves Another", lineIndex: 8 } },
  { cn: "它曾多次横渡大西洋。", en: "It has sailed across the Atlantic many times.", source: { book: "NCE2", lessonId: 12, title: "Goodbye and Good Luck", lineIndex: 4 } },
  { cn: "我们为他感到非常骄傲。", en: "We are very proud of him.", source: { book: "NCE2", lessonId: 12, title: "Goodbye and Good Luck", lineIndex: 8 } },
  { cn: "在这些场合下，情况总是如此。", en: "It is always the same on these occasions.", source: { book: "NCE2", lessonId: 13, title: "The Greenwood Boys", lineIndex: 13 } },
  { cn: "我知道轮到我了。", en: "I knew that my turn had come.", source: { book: "NCE2", lessonId: 15, title: "Good News", lineIndex: 6 } },
  { cn: "然而，这并不总是发生。", en: "However, this does not always happen.", source: { book: "NCE2", lessonId: 16, title: "A Polite Request", lineIndex: 3 } },
  { cn: "先生，我们欢迎您来到我们的城市。", en: "Sir, we welcome you to our city.", source: { book: "NCE2", lessonId: 16, title: "A Polite Request", lineIndex: 6 } },
  { cn: "如果您留意我们的路标，您会在这里度过愉快的时光。", en: "You will enjoy your stay here if you pay attention to our street signs.", source: { book: "NCE2", lessonId: 16, title: "A Polite Request", lineIndex: 8 } },
  { cn: "这张纸条只是一个提醒。", en: "This note is only a reminder.", source: { book: "NCE2", lessonId: 16, title: "A Polite Request", lineIndex: 9 } },
  { cn: "钓鱼是我最喜欢的运动。", en: "Fishing is my favourite sport.", source: { book: "NCE2", lessonId: 20, title: "One Man in a Boat", lineIndex: 0 } },
  { cn: "我经常钓好几个小时，却什么也钓不到。", en: "I often fish for hours without catching anything.", source: { book: "NCE2", lessonId: 20, title: "One Man in a Boat", lineIndex: 1 } },
  { cn: "我总是空手而归。", en: "I always go home with an empty bag.", source: { book: "NCE2", lessonId: 20, title: "One Man in a Boat", lineIndex: 9 } },
  { cn: "这是浪费时间。", en: "It's a waste of time.", source: { book: "NCE2", lessonId: 20, title: "One Man in a Boat", lineIndex: 12 } },
  { cn: "我对钓鱼不感兴趣。", en: "I'm not interested in fishing.", source: { book: "NCE2", lessonId: 20, title: "One Man in a Boat", lineIndex: 14 } },
  { cn: "我只对坐在船上什么也不做感兴趣。", en: "I am only interested in sitting in a boat and doing nothing at all.", source: { book: "NCE2", lessonId: 20, title: "One Man in a Boat", lineIndex: 15 } },
  { cn: "飞机正慢慢地把我逼疯。", en: "Aeroplanes are slowly driving me mad.", source: { book: "NCE2", lessonId: 21, title: "Mad or Not", lineIndex: 0 } },
  { cn: "每个人都说我一定是疯了。", en: "Everybody says I must be mad.", source: { book: "NCE2", lessonId: 21, title: "Mad or Not", lineIndex: 10 } },
  { cn: "现在两个女孩都定期给对方写信。", en: "Both girls write to each other regularly now.", source: { book: "NCE2", lessonId: 22, title: "A Glass Envelope", lineIndex: 5 } },
  { cn: "信件的花费会多一点，但肯定会更快送达。", en: "Letters will cost a little more, but they will certainly travel faster.", source: { book: "NCE2", lessonId: 22, title: "A Glass Envelope", lineIndex: 7 } },
  { cn: "我们现在正住在乡村的一座漂亮的新房子里。", en: "We are now living in a beautiful new house in the country.", source: { book: "NCE2", lessonId: 23, title: "A New House", lineIndex: 6 } },
  { cn: "它一定是这个地区唯一一座现代化的房子。", en: "It must be the only modern house in the district.", source: { book: "NCE2", lessonId: 23, title: "A New House", lineIndex: 15 } },
  { cn: "在英国每个人都说不同的语言。", en: "In England each man speaks a different language.", source: { book: "NCE2", lessonId: 25, title: "Do the English Speak English", lineIndex: 14 } },
  { cn: "英国人彼此都能听懂，可我听不懂他们。", en: "The English understand each other, but I don’t understand them.", source: { book: "NCE2", lessonId: 25, title: "Do the English Speak English", lineIndex: 15 } },
  { cn: "许多人假装他们懂现代艺术。", en: "Many people pretend that they understand modern art.", source: { book: "NCE2", lessonId: 26, title: "The Best Art Critics", lineIndex: 1 } },
  { cn: "当然，许多画根本不是关于任何东西的。", en: "Of course, many pictures are not about anything.", source: { book: "NCE2", lessonId: 26, title: "The Best Art Critics", lineIndex: 3 } },
  { cn: "它们只是漂亮的图案。", en: "They are just pretty patterns.", source: { book: "NCE2", lessonId: 26, title: "The Best Art Critics", lineIndex: 4 } },
  { cn: "我认为小孩子往往比其他人更能欣赏现代画。", en: "I think that young children often appreciate modern pictures better than anyone else.", source: { book: "NCE2", lessonId: 26, title: "The Best Art Critics", lineIndex: 6 } },
  { cn: "她是对的。", en: "She was right.", source: { book: "NCE2", lessonId: 26, title: "The Best Art Critics", lineIndex: 20 } },
  { cn: "他们都饿了，饭菜闻起来很香。", en: "They were all hungry and the food smelled good.", source: { book: "NCE2", lessonId: 27, title: "A Wet Night", lineIndex: 2 } },
  { cn: "美餐一顿后，他们围着篝火讲故事、唱歌。", en: "After a wonderful meal, they told stories and sang songs by the campfire.", source: { book: "NCE2", lessonId: 27, title: "A Wet Night", lineIndex: 3 } },
  { cn: "贾斯珀·怀特是那种相信古代神话的罕见人物之一。", en: "Jasper White is one of those rare people who believes in ancient myths.", source: { book: "NCE2", lessonId: 28, title: "No Parking", lineIndex: 0 } },
  { cn: "那是我见过最丑陋的面孔之一。", en: "It is one of the ugliest faces I have ever seen.", source: { book: "NCE2", lessonId: 28, title: "No Parking", lineIndex: 11 } },
  { cn: "这架奇妙的飞机可以载七名乘客。", en: "This wonderful plane can carry seven passengers.", source: { book: "NCE2", lessonId: 29, title: "Taxi", lineIndex: 2 } },
  { cn: "弗兰克回想起他艰难的早年岁月和漫长的成功之路时，露出了笑容。", en: "Frank smiled when he remembered his hard early years and the long road to success.", source: { book: "NCE2", lessonId: 31, title: "Success Story", lineIndex: 9 } },
  { cn: "人们不再像以前那样诚实了。", en: "People are not so honest as they once were.", source: { book: "NCE2", lessonId: 32, title: "Shopping Made Easy", lineIndex: 0 } },
  { cn: "这个女孩每周给她母亲一件免费的连衣裙。", en: "The girl gave her mother a free dress once a week.", source: { book: "NCE2", lessonId: 32, title: "Shopping Made Easy", lineIndex: 9 } },
  { cn: "那就是她所记得的一切。", en: "That was all she remembered.", source: { book: "NCE2", lessonId: 33, title: "Out of the Darkness", lineIndex: 8 } },
  { cn: "一天后她醒来时，发现自己躺在医院里。", en: "When she woke up a day later, she found herself in hospital.", source: { book: "NCE2", lessonId: 33, title: "Out of the Darkness", lineIndex: 9 } },
  { cn: "泰德听到这个消息时非常惊讶。", en: "Ted was most surprised when he heard the news.", source: { book: "NCE2", lessonId: 34, title: "Quick Work", lineIndex: 8 } },
  { cn: "那是20年前，泰德15岁时被偷的。", en: "It was stolen 20 years ago when Ted was a boy of 15.", source: { book: "NCE2", lessonId: 34, title: "Quick Work", lineIndex: 11 } },
  { cn: "他发现他的新工作远比以前刺激。", en: "He is finding his new work far more exciting.", source: { book: "NCE2", lessonId: 35, title: "Stop Thief", lineIndex: 3 } },
  { cn: "他的表现就好像他以前从未在英国生活过一样。", en: "He acted as if he had never lived in England before.", source: { book: "NCE2", lessonId: 38, title: "Everything Except the Weather", lineIndex: 14 } },
  { cn: "我试图和她攀谈。", en: "I tried to make conversation.", source: { book: "NCE2", lessonId: 40, title: "Food and Talk", lineIndex: 8 } },
  { cn: "我几乎立刻就后悔说了那句话。", en: "I regretted saying it almost at once.", source: { book: "NCE2", lessonId: 41, title: "Do You Call That a Hat", lineIndex: 5 } },
  { cn: "男人永远不嫌领带多。", en: "A man can never have too many ties.", source: { book: "NCE2", lessonId: 41, title: "Do You Call That a Hat", lineIndex: 9 } },
  { cn: "然而，这条蛇仍然缓慢地舞动着。", en: "The snake, however, continued to dance slowly.", source: { book: "NCE2", lessonId: 42, title: "Not Very Musical", lineIndex: 9 } },
  { cn: "它显然分辨不出印度音乐和爵士乐的区别。", en: "It obviously could not tell the difference between Indian music and jazz.", source: { book: "NCE2", lessonId: 42, title: "Not Very Musical", lineIndex: 10 } },
  { cn: "飞机能够毫不费力地飞越无尽的白色平原。", en: "The aircraft was able to fly over the endless white plains without difficulty.", source: { book: "NCE2", lessonId: 43, title: "Over the South Pole", lineIndex: 8 } },
  { cn: "最终，山姆所有的钱都以这种方式还了回来。", en: "In time, all Sam's money was paid back in this way.", source: { book: "NCE2", lessonId: 45, title: "A Clear Conscience", lineIndex: 9 } },
  { cn: "最后的纸条写道：我现在100%诚实了。", en: "The last note said: I am 100% honest now.", source: { book: "NCE2", lessonId: 45, title: "A Clear Conscience", lineIndex: 10 } },
  { cn: "他被眼前发现的东西惊呆了。", en: "He was astonished at what he found.", source: { book: "NCE2", lessonId: 46, title: "Expensive and Uncomfortable", lineIndex: 4 } },
  { cn: "一张机票的正常价格是230英镑。", en: "The normal price of a ticket is 230 pounds.", source: { book: "NCE2", lessonId: 46, title: "Expensive and Uncomfortable", lineIndex: 11 } },
  { cn: "牙医总是在你无法回答的时候提问。", en: "Dentists always ask questions when it is impossible for you to answer.", source: { book: "NCE2", lessonId: 48, title: "Did You Want to Tell Me Something", lineIndex: 0 } },
  { cn: "我突然感到非常担心，但什么也说不出来。", en: "I suddenly felt very worried, but could not say anything.", source: { book: "NCE2", lessonId: 48, title: "Did You Want to Tell Me Something", lineIndex: 7 } },
  { cn: "我们就到这儿了。", en: "This is as far as we go.", source: { book: "NCE2", lessonId: 50, title: "Taken for a Ride", lineIndex: 17 } },
  { cn: "我宁愿留在车上。", en: "I prefer to stay on the bus.", source: { book: "NCE2", lessonId: 50, title: "Taken for a Ride", lineIndex: 29 } },
  { cn: "很明显，他非常尴尬。", en: "It was obvious that he was very embarrassed.", source: { book: "NCE2", lessonId: 51, title: "Reward for Virtue", lineIndex: 10 } },
  { cn: "这并不容易，因为我拥有一千多本书。", en: "This has not been easy because I own over a thousand books.", source: { book: "NCE2", lessonId: 52, title: "A Pretty Carpet", lineIndex: 3 } },
  { cn: "更糟的是，房间相当小。", en: "To make matters worse, the room is rather small.", source: { book: "NCE2", lessonId: 52, title: "A Pretty Carpet", lineIndex: 4 } },
  { cn: "目前，它们占据了每一寸地板空间。", en: "At the moment, they cover every inch of floor space.", source: { book: "NCE2", lessonId: 52, title: "A Pretty Carpet", lineIndex: 6 } },
  { cn: "通过这种方式，他解开了这个谜团。", en: "In this way, he was able to solve the mystery.", source: { book: "NCE2", lessonId: 53, title: "Hot Snake", lineIndex: 7 } },
  { cn: "解释很简单，但非常不寻常。", en: "The explanation was simple, but very unusual.", source: { book: "NCE2", lessonId: 53, title: "Hot Snake", lineIndex: 8 } },
  { cn: "孩子们在学校，我丈夫在上班，家里一片宁静。", en: "The children were at school, my husband was at work, and the house was quiet.", source: { book: "NCE2", lessonId: 54, title: "Sticky Fingers", lineIndex: 2 } },
  { cn: "没有什么比这更烦人的了。", en: "Nothing could have been more annoying.", source: { book: "NCE2", lessonId: 54, title: "Sticky Fingers", lineIndex: 6 } },
  { cn: "真是一团糟！", en: "What a mess!", source: { book: "NCE2", lessonId: 54, title: "Sticky Fingers", lineIndex: 10 } },
  { cn: "寻找失落宝藏的梦想最近几乎成真。", en: "Dreams of finding lost treasure almost came true recently.", source: { book: "NCE2", lessonId: 55, title: "Not a Gold Mine", lineIndex: 0 } },
  { cn: "尽管如此，许多人仍相信“揭示者”可能很快会揭示出一些有价值的东西。", en: "In spite of this, many people are confident that the Revealer may reveal something of value fairly soon.", source: { book: "NCE2", lessonId: 55, title: "Not a Gold Mine", lineIndex: 15 } },
  { cn: "它建于1885年，是参赛车辆中最古老的一辆。", en: "Built in 1885, it was the oldest car taking part.", source: { book: "NCE2", lessonId: 56, title: "Faster Than Sound", lineIndex: 4 } },
  { cn: "这场比赛给每个人带来了极大的乐趣。", en: "The race gave everyone a great deal of pleasure.", source: { book: "NCE2", lessonId: 56, title: "Faster Than Sound", lineIndex: 10 } },
  { cn: "它与现代汽车比赛大不相同，但同样激动人心。", en: "It was very different from modern car races, but no less exciting.", source: { book: "NCE2", lessonId: 56, title: "Faster Than Sound", lineIndex: 11 } },
  { cn: "她一看到那件连衣裙，就说不喜欢。", en: "As soon as she saw it, the woman said she did not like it.", source: { book: "NCE2", lessonId: 57, title: "Can I Help You, Madam", lineIndex: 9 } },
  { cn: "据说，如果有人触摸这棵树，他就会遭遇厄运。", en: "It is said that if anyone touches the tree, he will have bad luck.", source: { book: "NCE2", lessonId: 58, title: "A Blessing in Disguise", lineIndex: 4 } },
  { cn: "如果他摘一片叶子，他就会死去。", en: "If he picks a leaf, he will die.", source: { book: "NCE2", lessonId: 58, title: "A Blessing in Disguise", lineIndex: 5 } },
  { cn: "到目前为止，他们中没有一个人因猝死而倒下。", en: "So far, not one of them has been struck down by sudden death.", source: { book: "NCE2", lessonId: 58, title: "A Blessing in Disguise", lineIndex: 10 } },
  { cn: "雷克斯很快就成了开门的专家。", en: "Rex soon became an expert at opening the gate.", source: { book: "NCE2", lessonId: 59, title: "In or Out", lineIndex: 3 } },
  { cn: "这种能力在未来前往遥远行星的飞行中是必要的。", en: "The ability to do this will be necessary in future flights to distant planets.", source: { book: "NCE2", lessonId: 61, title: "Trouble with the Hubble", lineIndex: 3 } },
  { cn: "不久前，参天大树覆盖着方圆数英里的乡村。", en: "A short time before, great trees had covered the countryside for miles around.", source: { book: "NCE2", lessonId: 62, title: "After the Fire", lineIndex: 2 } },
  { cn: "然而，到那时，许多地方的草皮已经扎下了根。", en: "By then, however, in many places the grass had already taken root.", source: { book: "NCE2", lessonId: 62, title: "After the Fire", lineIndex: 12 } },
  { cn: "大家都因为他出色的幽默感而敬佩他。", en: "Everybody admires him for his fine sense of humor.", source: { book: "NCE2", lessonId: 63, title: "She Was Not Amused", lineIndex: 1 } },
  { cn: "这正是杰弗里喜欢做的事情。", en: "This is the sort of thing that Jeffrey loves.", source: { book: "NCE2", lessonId: 63, title: "She Was Not Amused", lineIndex: 4 } },
  { cn: "令他惊讶的是，她说她不喜欢。", en: "To his surprise, she said she hadn't.", source: { book: "NCE2", lessonId: 63, title: "She Was Not Amused", lineIndex: 10 } },
  { cn: "这个平台将兼作港口和火车站。", en: "This platform would serve as a port and a railway station.", source: { book: "NCE2", lessonId: 64, title: "The Channel Tunnel", lineIndex: 2 } },
  { cn: "如果它建成，将是历史上第一次把英国和欧洲连接起来。", en: "If it is built, it will connect Britain to Europe for the first time in history.", source: { book: "NCE2", lessonId: 64, title: "The Channel Tunnel", lineIndex: 10 } },
  { cn: "许多人对这项新奇而不寻常的运动表现出了兴趣。", en: "Many people have shown interest in this new and unusual sport.", source: { book: "NCE2", lessonId: 66, title: "Sweet as Honey", lineIndex: 16 } },
  { cn: "塔兹耶夫经常以这种方式冒着生命危险。", en: "Tazieff has often risked his life in this way.", source: { book: "NCE2", lessonId: 67, title: "Volcanoes", lineIndex: 13 } },
  { cn: "他向我们讲述的关于活跃火山的知识比任何在世的人都多。", en: "He has been able to tell us more about active volcanoes than any man alive.", source: { book: "NCE2", lessonId: 67, title: "Volcanoes", lineIndex: 14 } },
  { cn: "我从不喜欢遇见伯特·戴克斯。", en: "I never enjoy meeting Bert Dykes.", source: { book: "NCE2", lessonId: 68, title: "Persistent", lineIndex: 4 } },
  { cn: "他总是无所事事。", en: "He never has anything to do.", source: { book: "NCE2", lessonId: 68, title: "Persistent", lineIndex: 5 } },
  { cn: "确信自己已经通过了，我几乎开始享受我的考试了。", en: "Sure that I had passed, I was almost beginning to enjoy my test.", source: { book: "NCE2", lessonId: 69, title: "But not Murder", lineIndex: 2 } },
  { cn: "尽管声音听得很清楚，但我花了很长时间才做出反应。", en: "Though the sound could be heard clearly, it took me a long time to react.", source: { book: "NCE2", lessonId: 69, title: "But not Murder", lineIndex: 9 } },
  { cn: "人群突然安静下来。", en: "The crowd suddenly grew quiet.", source: { book: "NCE2", lessonId: 70, title: "Red for Danger", lineIndex: 10 } },
  { cn: "大本钟很少出问题。", en: "Big Ben has rarely gone wrong.", source: { book: "NCE2", lessonId: 71, title: "A Famous Clock", lineIndex: 15 } },
  { cn: "从那时起，赛车手们已经达到了每小时400英里以上的速度。", en: "Since that time, racing drivers have reached speeds of over 400 miles an hour.", source: { book: "NCE2", lessonId: 72, title: "A Car Called Bluebird", lineIndex: 18 } },
  { cn: "他悄悄溜走时，没有人注意到他。", en: "No one noticed the boy as he crept off.", source: { book: "NCE2", lessonId: 73, title: "The Record", lineIndex: 13 } },
  { cn: "当时正值隆冬。", en: "It was the middle of winter.", source: { book: "NCE2", lessonId: 75, title: "SOS", lineIndex: 4 } },
  { cn: "雪厚厚地覆盖着地面。", en: "Snow lay thick on the ground.", source: { book: "NCE2", lessonId: 75, title: "SOS", lineIndex: 5 } },
  { cn: "然后她有了一个主意。", en: "Then she had an idea.", source: { book: "NCE2", lessonId: 75, title: "SOS", lineIndex: 16 } },
  { cn: "她在雪中踩出了SOS的字样。", en: "She stamped out the letters SOS in the snow.", source: { book: "NCE2", lessonId: 75, title: "SOS", lineIndex: 17 } },
  { cn: "我点燃了一支烟来镇定我的神经。", en: "I lit a cigarette to calm my nerves.", source: { book: "NCE2", lessonId: 78, title: "The Last One", lineIndex: 2 } },
  { cn: "这样过了七天，我参加了一个派对。", en: "After seven days of this, I went to a party.", source: { book: "NCE2", lessonId: 78, title: "The Last One", lineIndex: 11 } },
  { cn: "周围每个人都在吸烟，我感到非常不舒服。", en: "Everybody around me was smoking, and I felt extremely uncomfortable.", source: { book: "NCE2", lessonId: 78, title: "The Last One", lineIndex: 12 } },
  { cn: "我妻子很高兴一切又恢复了正常。", en: "My wife was delighted that things had returned to normal once more.", source: { book: "NCE2", lessonId: 78, title: "The Last One", lineIndex: 16 } },
  { cn: "我小时候经常乘飞机旅行。", en: "I used to travel by air a great deal when I was a boy.", source: { book: "NCE2", lessonId: 79, title: "By Air", lineIndex: 0 } },
  { cn: "一位空姐会照顾我，我从未有过不愉快的经历。", en: "An air hostess would take charge of me, and I never had an unpleasant experience.", source: { book: "NCE2", lessonId: 79, title: "By Air", lineIndex: 3 } },
  { cn: "幸运的是，什么也没找到，五个小时后，我们又可以起飞了。", en: "Fortunately, nothing was found, and five hours later, we were able to take off again.", source: { book: "NCE2", lessonId: 79, title: "By Air", lineIndex: 11 } },
  { cn: "还有大量的机器展出。", en: "There was also a great deal of machinery on display.", source: { book: "NCE2", lessonId: 80, title: "The Crystal Palace", lineIndex: 8 } },
  { cn: "他年纪相当大，头发灰白，眼睛湛蓝清澈。", en: "He was rather elderly with grey hair and clear blue eyes.", source: { book: "NCE2", lessonId: 81, title: "Escape", lineIndex: 19 } },
  { cn: "渔民和水手有时声称在海上见过怪物。", en: "Fishermen and sailors sometimes claimed to have seen monsters in the sea.", source: { book: "NCE2", lessonId: 82, title: "Monster or Fish", lineIndex: 0 } },
  { cn: "这次，尽管那位警察有点怀疑，但他还是做了同样的回答。", en: "Though a little suspicious this time, the policeman gave him the same answer.", source: { book: "NCE2", lessonId: 83, title: "After the Elections", lineIndex: 7 } },
  { cn: "没人知道罢工会持续多久。", en: "No one knows how long it will last.", source: { book: "NCE2", lessonId: 84, title: "On Strike", lineIndex: 2 } },
  { cn: "大多数人认为罢工至少会持续一周。", en: "Most people believe that the strike will last for at least a week.", source: { book: "NCE2", lessonId: 84, title: "On Strike", lineIndex: 5 } },
  { cn: "这将在一定程度上缓解火车的压力。", en: "This will relieve pressure on the trains to some extent.", source: { book: "NCE2", lessonId: 84, title: "On Strike", lineIndex: 8 } },
  { cn: "即便如此，人们仍然会发现上班很困难。", en: "Even so, people are going to find it difficult to get to work.", source: { book: "NCE2", lessonId: 84, title: "On Strike", lineIndex: 14 } },
  { cn: "对他来说，这将是一个全新的爱好。", en: "For him, this will be an entirely new hobby.", source: { book: "NCE2", lessonId: 85, title: "Never Too Old To Learn", lineIndex: 22 } },
  { cn: "然而，这一次快艇的速度大大减慢了。", en: "On this occasion, however, it had slowed down considerably.", source: { book: "NCE2", lessonId: 86, title: "Out of Control", lineIndex: 16 } },
  { cn: "汽油差不多已经用完了。", en: "The petrol had nearly all been used up.", source: { book: "NCE2", lessonId: 86, title: "Out of Control", lineIndex: 17 } },
  { cn: "然而，救援行动进展困难。", en: "However, rescue operations are proving difficult.", source: { book: "NCE2", lessonId: 88, title: "Trapped in a Mine", lineIndex: 3 } },
  { cn: "他们被告知救援行动进展顺利。", en: "They have been told that rescue operations are progressing smoothly.", source: { book: "NCE2", lessonId: 88, title: "Trapped in a Mine", lineIndex: 17 } },
  { cn: "巴西利亚经过精心规划，以适应现代生活。", en: "Brasilia has been carefully planned for modern living.", source: { book: "NCE2", lessonId: 90, title: "What's for Supper", lineIndex: 10 } },
  { cn: "孩子们上学不必穿过繁忙的街道。", en: "Children do not have to cross busy streets to go to school.", source: { book: "NCE2", lessonId: 90, title: "What's for Supper", lineIndex: 13 } },
  { cn: "巴西利亚已迅速确立了其作为国家首都的地位。", en: "Brasilia has quickly established itself as the capital of the country.", source: { book: "NCE2", lessonId: 90, title: "What's for Supper", lineIndex: 21 } },
  { cn: "我回到家时，大概是凌晨两点钟。", en: "It must have been about two in the morning when I returned home.", source: { book: "NCE2", lessonId: 92, title: "Asking for Trouble", lineIndex: 0 } },
  { cn: "这个节日是一个欢乐的时刻。", en: "This festival is a cheerful occasion.", source: { book: "NCE2", lessonId: 96, title: "The Dead Return", lineIndex: 0 } },
  { cn: "整夜，人们都在跳舞唱歌。", en: "All night long, people dance and sing.", source: { book: "NCE2", lessonId: 96, title: "The Dead Return", lineIndex: 7 } },
];

/** 池长度：供取模轮回使用（此处导出仅为便于调用方只读引用，不改池内容） */
export const DAILY_QUOTES_COUNT = DAILY_QUOTES.length;
