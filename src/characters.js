// South Park キャラクター台帳 + WebVTT話者抽出
'use strict';

const SPJS_CHARACTERS = (() => {
  // 口調・呼称を変えた時にAI自然訳キャッシュを自動で無効化する。
  const PROFILE_VERSION = 6;

  // profiles は短く保つ。詳細を全件プロンプトへ常駐させず、該当話者だけ渡す。
  // addresses は「この人物が相手をどう呼ぶか」。未確認の呼称は固定しない。
  const profiles = {
    stan: {
      nameJa: 'スタン', nameEn: 'Stan Marsh',
      aliases: ['Stan', 'Stan Marsh', 'Stanley', 'Stanley Marsh'],
      voice: '一人称はWOWOW系の定着に寄せて「俺」。癖の薄い自然な少年語。低温の呆れと乾いたツッコミは短くする。',
      traits: '思慮深く共感的なグループの常識人。大人、とくに父ランディの暴走には呆れ気味。',
      sample: 'ああ……これ、かなりヤバくないか？',
      examples: [{ en: "Dude, that's messed up.", ja: 'おい それヤバいだろ', register: 'peer' }],
      addresses: { randy: 'パパ', sharon: 'ママ', shelley: 'シェリー', kyle: 'カイル', cartman: 'カートマン' },
    },
    kyle: {
      nameJa: 'カイル', nameEn: 'Kyle Broflovski',
      aliases: ['Kyle', 'Kyle Broflovski', 'Kyle Broflovsky'],
      voice: '一人称は「僕」。頭の回転が速く筋道立った常体。怒ると語気が鋭くなるが大人びさせすぎない。',
      traits: '倫理観と正義感が強い。カートマンの差別や身勝手さに強く反発する。',
      sample: '違うだろ　問題はそこじゃないんだよ',
      examples: [{ en: "That's not the point, Cartman.", ja: '違うだろ カートマン　問題はそこじゃない', register: 'peer' }],
      addresses: { stan: 'スタン', cartman: 'カートマン', ike: 'アイク', sheila: 'ママ', gerald: 'パパ' },
    },
    cartman: {
      nameJa: 'カートマン', nameEn: 'Eric Cartman',
      aliases: ['Cartman', 'Eric Cartman', 'Eric', 'E. Cartman'],
      voice: '一人称はWOWOW版に寄せて「オイラ」。子供っぽく尊大で、命令・自慢・言い逃れは芝居がかった口調。罵倒や差別表現を勝手に弱めない。',
      traits: '短気で自己中心的、人を操るのが得意。母には甘え、カイルには執拗に挑発的。',
      sample: 'ママ～！ オイラの言うこと聞いてよ！',
      examples: [{ en: 'You guys have to listen to me!', ja: 'お前ら オイラの話を聞け！', register: 'peer' }],
      addresses: { liane: 'ママ', stan: 'スタン', kyle: 'カイル', kenny: 'ケニー', butters: 'バターズ' },
    },
    kenny: {
      nameJa: 'ケニー', nameEn: 'Kenny McCormick',
      aliases: ['Kenny', 'Kenny McCormick', 'Kenneth McCormick'],
      voice: '少年らしい砕けた常体。フード越しの不明瞭さは、原文で判読できる内容まで消さず、下品さや機転も保つ。',
      traits: '貧しい家庭で育つが仲間思い。性的・下品な冗談にも詳しい。',
      examples: [{ en: 'Are you guys serious?', ja: 'お前ら マジかよ？', register: 'peer' }],
      addresses: { stan: 'スタン', kyle: 'カイル', cartman: 'カートマン', stuart: '父さん', carol: '母さん' },
    },
    butters: {
      nameJa: 'バターズ', nameEn: 'Butters Stotch',
      aliases: ['Butters', 'Butters Stotch', 'Leopold Stotch', 'Leopold'],
      voice: '一人称は「ぼく」。素直で柔らかい子供口調。大人にはです・ますを使う。過剰な幼児語にはせず、ためらいや無邪気な感嘆を残す。',
      traits: '純真で人を信じやすく、怖がりながらも楽観的。親やカートマンに利用されがち。',
      sample: 'えっ ぼくそんなつもりじゃないよ',
      examples: [
        { en: 'Do you really think so?', ja: '本当にそう思うの？', register: 'peer' },
        { en: "I didn't mean to, sir.", ja: 'そんなつもりじゃないんです 先生', register: 'adult' },
      ],
      addresses: { cartman: 'エリック', stephen: 'パパ', linda: 'ママ', stan: 'スタン', kyle: 'カイル' },
      addressRules: ['同年代には柔らかい常体。大人には原文と場面に応じてです・ますを使う'],
    },
    wendy: {
      nameJa: 'ウェンディ', nameEn: 'Wendy Testaburger',
      aliases: ['Wendy', 'Wendy Testaburger'],
      voice: '一人称は「私」。知的で明快な少女の常体。主張は強くても不自然なお嬢様言葉にはしない。',
      traits: '成績優秀で社会意識が高く、必要なら毅然と対立する。',
      examples: [{ en: "That's not funny, Cartman.", ja: '笑い事じゃないよ カートマン', register: 'peer' }],
      addresses: { stan: 'スタン', cartman: 'カートマン' },
    },
    craig: {
      nameJa: 'クレイグ', nameEn: 'Craig Tucker',
      aliases: ['Craig', 'Craig Tucker'],
      voice: '一人称は「俺」。低温でぶっきらぼうな短文。皮肉やうんざり感を淡々と出す。',
      traits: '現実的で無表情。周囲の騒動を冷めた目で見る。',
      examples: [{ en: "I told you I didn't want to go.", ja: '行きたくないって言っただろ', register: 'peer' }],
      addresses: { tweek: 'トゥイーク' },
    },
    tweek: {
      nameJa: 'トゥイーク', nameEn: 'Tweek Tweak',
      aliases: ['Tweek', 'Tweek Tweak'],
      voice: '一人称は「僕」。神経質で切迫した短い発話。原文のどもり・叫び・言い直しを読みやすい範囲で残す。',
      traits: '極度に不安が強く、些細なことにもパニックになる。',
      examples: [{ en: "I can't do this!", ja: '無理だよ！ できない！', register: 'peer' }],
      addresses: { craig: 'クレイグ' },
    },
    jimmy: {
      nameJa: 'ジミー', nameEn: 'Jimmy Valmer',
      aliases: ['Jimmy', 'Jimmy Valmer', 'Jimmy Vulmer'],
      voice: '一人称は「僕」。明るく人前慣れした少年口調。原文にあるどもりは意味を邪魔しない範囲で示す。',
      traits: '社交的なコメディアン気質で、言葉遊びや舞台調の間を好む。',
      examples: [{ en: 'This is gonna be great.', ja: 'こいつは傑作になるよ', register: 'peer' }],
      addresses: {},
    },
    tolkien: {
      nameJa: 'トールキン', nameEn: 'Tolkien Black',
      aliases: ['Tolkien', 'Tolkien Black', 'Token', 'Token Black'],
      voice: '一人称は「僕」。落ち着いた自然な少年口調。人種を理由にステレオタイプな語尾を足さない。原文のToken/Tolkien表記は劇中の言葉遊びになり得るため勝手に統一しない。',
      traits: '比較的裕福で冷静。友人の無理解にははっきり反論する。',
      examples: [{ en: "I didn't ask for this.", ja: '僕はそんなこと頼んでないけど', register: 'peer' }],
      addresses: {},
    },
    randy: {
      nameJa: 'ランディ', nameEn: 'Randy Marsh',
      aliases: ['Randy', 'Randy Marsh'],
      voice: '一人称は文脈に応じて「俺」または「僕」。普通の父親口調から、自己陶酔・逆上・泣き言へ大げさに振れる。',
      traits: '衝動的で自意識過剰。自分を正当化しながら騒動を拡大しやすい。',
      sample: 'スタンリー、聞いてくれ　これは家族のためなんだ！',
      examples: [{ en: "Stan, trust me. Dad knows what he's doing.", ja: 'スタン パパに任せろ\nちゃんと分かってる！', register: 'family' }],
      addresses: { stan: 'スタン', sharon: 'シャロン', shelley: 'シェリー' },
      addressRules: ['感情が高ぶった時や改まった呼びかけでは、スタンを「スタンリー」と呼ぶ'],
    },
    sharon: {
      nameJa: 'シャロン', nameEn: 'Sharon Marsh',
      aliases: ['Sharon', 'Sharon Marsh', 'Mrs. Marsh'],
      voice: '一人称は「私」。現実的な母親の口調。ランディへの苛立ちは自然で鋭いが、常に怒鳴らせない。',
      traits: '家族内の常識人。夫の無謀さをたしなめ、子供を気遣う。',
      examples: [{ en: "Randy, this isn't about you.", ja: 'ランディ あなたの話じゃないの', register: 'family' }],
      addresses: { stan: 'スタン', randy: 'ランディ', shelley: 'シェリー' },
      addressRules: ['強い心配・叱責時は、スタンを「スタンリー」と呼ぶ'],
    },
    shelley: {
      nameJa: 'シェリー', nameEn: 'Shelley Marsh',
      aliases: ['Shelley', 'Shelley Marsh', 'Shelly', 'Shelly Marsh'],
      voice: '一人称は「あたし」。思春期の姉らしい荒っぽく不機嫌な口調。弟への威圧感を保つ。',
      traits: '短気でスタンに攻撃的だが、家族への情が皆無なわけではない。',
      addresses: { stan: 'スタン', randy: 'パパ', sharon: 'ママ' },
    },
    gerald: {
      nameJa: 'ジェラルド', nameEn: 'Gerald Broflovski',
      aliases: ['Gerald', 'Gerald Broflovski', 'Mr. Broflovski', 'Kyle\'s Dad'],
      voice: '一人称は「僕」または「私」。普段は理屈っぽい中流家庭の父親口調。専門家ぶる場面や身勝手さも隠さない。',
      traits: '弁護士で教育熱心だが、虚栄心や偽善も見せる。',
      examples: [{ en: "Kyle, there's a proper way to handle this.", ja: 'いいか カイル\nこういうのは筋を通すんだ', register: 'family' }],
      addresses: { kyle: 'カイル', ike: 'アイク', sheila: 'シーラ' },
    },
    sheila: {
      nameJa: 'シーラ', nameEn: 'Sheila Broflovski',
      aliases: ['Sheila', 'Sheila Broflovski', 'Mrs. Broflovski', 'Kyle\'s Mom'],
      voice: '一人称は「私」。過保護で断定的、正義感が暴走すると声高で押しが強い。家族への愛情は残す。',
      traits: '行動力のある母親。子供を守ろうとして問題を大きくすることがある。',
      examples: [{ en: 'Kyle! What did you just say?', ja: 'カイル！ 今なんて言ったの？', register: 'family' }],
      addresses: { kyle: 'カイル', ike: 'アイク', gerald: 'ジェラルド' },
    },
    ike: {
      nameJa: 'アイク', nameEn: 'Ike Broflovski',
      aliases: ['Ike', 'Ike Broflovski', 'Ike Moisha Broflovski'],
      voice: '一人称は「ぼく」。幼い子供の短い口調。年齢以上に説明的な文を足さず、原文のませた面は残す。',
      traits: 'カイルの幼い養弟。素直さと意外な早熟さを併せ持つ。',
      examples: [{ en: 'Let me go, Kyle!', ja: '放して カイル！', register: 'family' }],
      addresses: { kyle: 'カイル', sheila: 'ママ', gerald: 'パパ' },
    },
    liane: {
      nameJa: 'リアン', nameEn: 'Liane Cartman',
      aliases: ['Liane', 'Liane Cartman', 'Mrs. Cartman', 'Cartman\'s Mom'],
      voice: '一人称は「私」。甘く過保護な母親口調。近年の毅然とした場面では語尾を締める。',
      traits: '息子を溺愛し、要求に流されやすい。近年は必要な境界線を引く場面もある。',
      sample: 'エリックちゃん、そんな言い方しちゃだめよ',
      examples: [{ en: "Eric, sweetie, don't talk like that.", ja: 'エリックちゃん そんな言い方しちゃだめよ', register: 'family' }],
      addresses: { cartman: 'エリックちゃん' },
      addressRules: ['平常・愛情時は「エリックちゃん」。本気で叱責する場面だけ「エリック」'],
    },
    stuart: {
      nameJa: 'スチュアート', nameEn: 'Stuart McCormick',
      aliases: ['Stuart', 'Stuart McCormick', 'Mr. McCormick', 'Kenny\'s Dad'],
      voice: '一人称は「俺」。荒っぽい労働者階級の父親口調。酔いや苛立ちは残すが、方言を勝手に足さない。',
      traits: '失業と貧困を抱え、酒癖が悪く夫婦げんかが多い。',
      examples: [{ en: 'Kenny, quit messing around.', ja: 'ケニー ふざけてないで働け', register: 'family' }],
      addresses: { kenny: 'ケニー', carol: 'キャロル' },
    },
    carol: {
      nameJa: 'キャロル', nameEn: 'Carol McCormick',
      aliases: ['Carol', 'Carol McCormick', 'Mrs. McCormick', 'Kenny\'s Mom'],
      voice: '一人称は「あたし」または「私」。生活疲れのある庶民的な口調。夫婦げんかでは荒くなる。',
      traits: '貧困家庭を切り盛りし、夫と衝突しつつ子供を気に掛ける。',
      examples: [{ en: 'Kenny, stay out of trouble.', ja: 'ケニー 面倒は起こさないでよ', register: 'family' }],
      addresses: { kenny: 'ケニー', stuart: 'スチュアート' },
    },
    stephen: {
      nameJa: 'スティーヴン', nameEn: 'Stephen Stotch',
      aliases: ['Stephen', 'Stephen Stotch', 'Chris Stotch', 'Mr. Stotch', 'Butters\' Dad'],
      voice: '一人称は「私」または「父さん」。権威的で説教くさい父親口調。体面を気にし、罰を大げさに宣告する。',
      traits: '厳格で偽善的。バターズをすぐ外出禁止にし、自分の矛盾には鈍感。',
      sample: 'バターズ、お前は一週間 外出禁止だ！',
      examples: [{ en: "Butters, that's enough. You're grounded!", ja: 'バターズ もうたくさんだ\nお前は外出禁止だ！', register: 'family' }],
      addresses: { butters: 'バターズ', linda: 'リンダ' },
      addressRules: ['処罰時は「バターズ、お前は外出禁止だ！」の型を優先する'],
    },
    linda: {
      nameJa: 'リンダ', nameEn: 'Linda Stotch',
      aliases: ['Linda', 'Linda Stotch', 'Mrs. Stotch', 'Butters\' Mom'],
      voice: '一人称は「私」または「ママ」。表面は穏やかだが、同調圧力や感情の振幅を残す。',
      traits: '夫とともにバターズへ過度に厳しく、体面を重んじる。',
      examples: [{ en: "Butters, why can't you behave?", ja: 'バターズ どうして普通にできないの？', register: 'family' }],
      addresses: { butters: 'バターズ', stephen: 'スティーヴン' },
    },
    garrison: {
      nameJa: 'ギャリソン先生', nameEn: 'Mr. Garrison',
      aliases: ['Garrison', 'Mr. Garrison', 'Mrs. Garrison', 'Herbert Garrison', 'Janet Garrison', 'President Garrison'],
      voice: '教師時は一人称「私」。皮肉で攻撃的、授業中でも感情や偏見が漏れる。役職・時代・性別表現は原文の文脈を優先する。',
      traits: '不安定で自己中心的。立場の変化が大きいため固定観念で補わない。',
      examples: [{ en: 'All right, children. Listen to me.', ja: 'はい みんな\n先生の話を聞け', register: 'teacher' }],
      addresses: {},
      addressRules: ['教師期に生徒を呼ぶ時は原則ファーストネーム。勝手に「君」「ちゃん」を足さない'],
    },
    mackey: {
      nameJa: 'マッケイ先生', nameEn: 'Mr. Mackey',
      aliases: ['Mackey', 'Mr. Mackey', 'Mr Mackey'],
      voice: '一人称は「私」。穏やかな生徒指導口調。原文の語尾 m’kay はWOWOW系の定着表現「ンケーイ」で残すが、原文にない文へ足さない。',
      traits: '学校カウンセラー。善意はあるが要領が悪く、定型的に諭す。',
      sample: '人の話は最後まで聞くんだよ、ンケーイ？',
      examples: [{ en: 'Listen to what people say, m’kay?', ja: '人の話は最後まで聞くんだよ ンケーイ？', register: 'teacher' }],
      addresses: {},
      addressRules: ['生徒は原則ファーストネームで呼ぶ'],
    },
    pc_principal: {
      nameJa: 'PC校長', nameEn: 'PC Principal',
      aliases: ['PC Principal', 'Principal PC', 'PC'],
      voice: '一人称は「俺」。体育会系で威圧的な断言口調。社会正義の専門語は正確にし、空疎なマッチョさも残す。',
      traits: '政治的公正を強硬に取り締まる校長。熱血さとパロディ性が同居する。',
      examples: [{ en: "Listen up, bro. That's not allowed here.", ja: 'よく聞け ブロ\nここじゃ許さない', register: 'teacher' }],
      addresses: {},
      addressRules: ['個人はファーストネーム、生徒集団には「お前たち」「みんな」'],
    },
    victoria: {
      nameJa: 'ヴィクトリア校長', nameEn: 'Principal Victoria',
      aliases: ['Principal Victoria', 'Victoria', 'Ms. Victoria'],
      voice: '一人称は「私」。落ち着いた学校管理職の口調。生徒への一対一は穏やかな常体、公的な校内放送だけ丁寧語。非常時には率直で強い。',
      traits: '概して現実的な校長だが、町の騒動には巻き込まれる。',
      examples: [{ en: "Wendy, don't let this beat you.", ja: 'ウェンディ 負けちゃだめよ', register: 'student' }],
      addresses: {},
    },
    chef: {
      nameJa: 'シェフ', nameEn: 'Chef',
      aliases: ['Chef', 'Jerome McElroy'],
      voice: '一人称は「俺」。温かく包容力のある大人の話し言葉。子供への助言は親しみ深く、性的な歌や冗談は検閲しない。',
      traits: '子供たちが頼る良識的な相談相手。歌と恋愛・性の話題を好む。',
      sample: 'いいかい、子供たち　まず落ち着いて考えるんだ',
      examples: [{ en: 'Listen, children. Think before you act.', ja: 'いいか みんな\n動く前によく考えるんだぞ', register: 'mentor' }],
      addresses: {},
      addressRules: ['個人はファーストネーム、集団には「子供たち」「みんな」'],
    },
  };

  function normalizeName(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, '');
  }

  const aliasToId = new Map();
  for (const [id, profile] of Object.entries(profiles)) {
    for (const alias of [id, profile.nameEn, profile.nameJa, ...(profile.aliases || [])]) {
      aliasToId.set(normalizeName(alias), id);
    }
  }

  const childIds = new Set([
    'stan', 'kyle', 'cartman', 'kenny', 'butters', 'wendy', 'craig', 'tweek',
    'jimmy', 'tolkien', 'ike', 'shelley',
  ]);
  const teacherIds = new Set(['garrison', 'mackey', 'pc_principal', 'victoria']);

  function socialGroup(id) {
    if (!id || !profiles[id]) return 'unknown';
    if (childIds.has(id)) return 'child';
    if (teacherIds.has(id)) return 'teacher';
    return 'adult';
  }

  function registerPolicy(speakerId, addresseeIds = []) {
    const speakerGroup = socialGroup(speakerId);
    const groups = [...new Set(addresseeIds.map(socialGroup).filter(group => group !== 'unknown'))];
    const peerOnly = groups.length > 0 && groups.every(group => group === 'child');
    const adultOnly = groups.length > 0 && groups.every(group => group === 'adult' || group === 'teacher');
    const forbiddenForms = ['です', 'ます', 'ください', 'でしょうか', 'ございます'];

    if (speakerGroup === 'child' && peerOnly) {
      return {
        mode: 'peer_casual',
        instruction: '相手候補は同年代の子供。芝居・引用・皮肉・公的発表や、原文どおりの怯えた懇願を除き、友達同士の短い常体にして敬語を使わない。',
        forbiddenForms,
        allowedExceptions: ['roleplay', 'quotation', 'sarcasm', 'public-speech', 'fearful-plea'],
      };
    }
    if (speakerGroup === 'child' && adultOnly) {
      return {
        mode: 'child_to_adult',
        instruction: speakerId === 'cartman'
          ? '相手候補は大人。カートマンを自動的に礼儀正しくせず、原文の無礼さ・甘え・芝居がかった調子を保つ。'
          : '相手候補は大人。原文の敬意、sir・ma’am・役職、人物設定に応じて自然な丁寧さを選ぶ。',
        forbiddenForms: [],
      };
    }
    if (speakerGroup === 'child') {
      return {
        mode: 'child_default_casual',
        instruction: '子供の普通の会話は常体を既定にする。大人への明確な呼びかけや公的な場面だけ丁寧語を使う。',
        forbiddenForms: [],
      };
    }
    if (speakerGroup === 'teacher' && peerOnly) {
      return {
        mode: 'teacher_to_student',
        instruction: '生徒への通常発話は教師らしい常体・指示・問いかけにする。儀礼的な場面以外で過剰なです・ます調にしない。',
        forbiddenForms: [],
      };
    }
    if (speakerGroup === 'adult' && peerOnly) {
      return {
        mode: 'adult_to_child',
        instruction: '親しい子供や自分の子への発話は自然な常体を基本にし、接客のような敬語にしない。',
        forbiddenForms: [],
      };
    }
    return {
      mode: speakerGroup === 'unknown' ? 'neutral_casual' : 'adult_contextual',
      instruction: speakerGroup === 'unknown'
        ? '話者不明。普通の会話は簡潔な常体を既定にし、英語に明確な丁寧さがある時だけ敬語にする。特定人物の口癖は足さない。'
        : '家族・友人・同僚には自然な常体を基本にし、公的・職務・初対面など原文に根拠がある時だけ敬語にする。',
      forbiddenForms: [],
    };
  }

  function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  }

  // 話者aliasとは別の翻訳表記台帳。原文に出た語だけpromptへ渡し、出力後にも検査する。
  const translationTermDefs = [
    { source: 'South Park Elementary School', exactJa: 'サウスパーク小学校', variants: ['南パーク小学校', '南公園小学校', 'サウス・パーク小学校', 'サウスパーク小学校学校'], mustPreserve: true },
    { source: 'South Park Elementary', exactJa: 'サウスパーク小学校', variants: ['南パーク小学校', '南公園小学校', 'サウス・パーク小学校'], mustPreserve: true },
    { source: 'South Park', exactJa: 'サウスパーク', variants: ['南パーク', '南公園', 'サウス・パーク', 'サウス パーク'], mustPreserve: true },
    { source: 'Eric Cartman', exactJa: 'エリック・カートマン', characterId: 'cartman' },
    { source: 'Kyle Broflovski', exactJa: 'カイル・ブロフロフスキー', characterId: 'kyle' },
    { source: 'Kyle Broflovsky', exactJa: 'カイル・ブロフロフスキー', characterId: 'kyle' },
    { source: 'Stan Marsh', exactJa: 'スタン・マーシュ', characterId: 'stan' },
    { source: 'Kenny McCormick', exactJa: 'ケニー・マコーミック', characterId: 'kenny' },
    { source: 'Butters Stotch', exactJa: 'バターズ・ストッチ', characterId: 'butters' },
    { source: 'Wendy Testaburger', exactJa: 'ウェンディ・テスタバーガー', characterId: 'wendy' },
    { source: 'Tolkien Black', exactJa: 'トールキン・ブラック', characterId: 'tolkien' },
    { source: 'Token Black', exactJa: 'トークン・ブラック', characterId: 'tolkien' },
    { source: 'Randy Marsh', exactJa: 'ランディ・マーシュ', characterId: 'randy' },
    { source: 'Sharon Marsh', exactJa: 'シャロン・マーシュ', characterId: 'sharon' },
    { source: 'Gerald Broflovski', exactJa: 'ジェラルド・ブロフロフスキー', characterId: 'gerald' },
    { source: 'Sheila Broflovski', exactJa: 'シーラ・ブロフロフスキー', characterId: 'sheila' },
    { source: 'Shelley Marsh', exactJa: 'シェリー・マーシュ', characterId: 'shelley' },
    { source: 'Liane Cartman', exactJa: 'リアン・カートマン', characterId: 'liane' },
    { source: 'Stuart McCormick', exactJa: 'スチュアート・マコーミック', characterId: 'stuart' },
    { source: 'Carol McCormick', exactJa: 'キャロル・マコーミック', characterId: 'carol' },
    { source: 'Stephen Stotch', exactJa: 'スティーヴン・ストッチ', characterId: 'stephen' },
    { source: 'Linda Stotch', exactJa: 'リンダ・ストッチ', characterId: 'linda' },
    { source: 'Mr. Garrison', exactJa: 'ギャリソン先生', characterId: 'garrison' },
    { source: 'Mr. Mackey', exactJa: 'マッケイ先生', characterId: 'mackey' },
    { source: 'PC Principal', exactJa: 'PC校長', characterId: 'pc_principal' },
    { source: 'Principal Victoria', exactJa: 'ヴィクトリア校長', characterId: 'victoria' },
    { source: 'Cartman', exactJa: 'カートマン', variants: ['カートメン'], characterId: 'cartman' },
    {
      source: 'Eric', exactJa: 'エリック', characterId: 'cartman',
      bySpeaker: { liane: { exactJa: 'エリックちゃん', acceptedJa: ['エリック'] } },
    },
    { source: 'Kyle', exactJa: 'カイル', variants: ['ケイル'], characterId: 'kyle' },
    { source: 'Stanley', exactJa: 'スタンリー', characterId: 'stan' },
    { source: 'Stan', exactJa: 'スタン', variants: ['ステン'], characterId: 'stan' },
    { source: 'Kenny', exactJa: 'ケニー', characterId: 'kenny' },
    { source: 'Butters', exactJa: 'バターズ', characterId: 'butters' },
    { source: 'Wendy', exactJa: 'ウェンディ', characterId: 'wendy' },
    { source: 'Craig', exactJa: 'クレイグ', characterId: 'craig' },
    { source: 'Tweek', exactJa: 'トゥイーク', characterId: 'tweek' },
    { source: 'Jimmy', exactJa: 'ジミー', characterId: 'jimmy' },
    { source: 'Tolkien', exactJa: 'トールキン', characterId: 'tolkien' },
    { source: 'Token', exactJa: 'トークン', characterId: 'tolkien' },
    { source: 'Ike', exactJa: 'アイク', characterId: 'ike' },
    { source: 'Randy', exactJa: 'ランディ', characterId: 'randy' },
    { source: 'Sharon', exactJa: 'シャロン', characterId: 'sharon' },
    { source: 'Gerald', exactJa: 'ジェラルド', characterId: 'gerald' },
    { source: 'Sheila', exactJa: 'シーラ', characterId: 'sheila' },
    { source: 'Shelley', exactJa: 'シェリー', variants: ['シェリ－'], characterId: 'shelley' },
    { source: 'Shelly', exactJa: 'シェリー', characterId: 'shelley' },
    { source: 'Liane', exactJa: 'リアン', characterId: 'liane' },
    { source: 'Stuart', exactJa: 'スチュアート', characterId: 'stuart' },
    { source: 'Carol', exactJa: 'キャロル', characterId: 'carol' },
    { source: 'Stephen', exactJa: 'スティーヴン', characterId: 'stephen' },
    { source: 'Linda', exactJa: 'リンダ', characterId: 'linda' },
    { source: 'Garrison', exactJa: 'ギャリソン', acceptedJa: ['ギャリソン先生'], characterId: 'garrison' },
    { source: 'Mackey', exactJa: 'マッケイ', acceptedJa: ['マッケイ先生'], characterId: 'mackey' },
    { source: 'Victoria', exactJa: 'ヴィクトリア', acceptedJa: ['ヴィクトリア校長'], characterId: 'victoria' },
    { source: 'Chef', exactJa: 'シェフ', characterId: 'chef' },
    { source: 'Colorado', exactJa: 'コロラド', mustPreserve: true },
    { source: 'Denver', exactJa: 'デンバー', mustPreserve: true },
    { source: 'Canada', exactJa: 'カナダ', mustPreserve: true },
  ].sort((a, b) => b.source.length - a.source.length);

  function isVocativeUse(text, start, end) {
    const before = text.slice(0, start).trim();
    const after = text.slice(end).trim();
    const initialMarker = /^(?:(?:well|oh|look|listen|okay|ok|come\s+on)\s*[,!:-]?\s*)?(?:hey(?:\s+there)?)?$/i;
    const atStart = initialMarker.test(before) && /^(?:[,!?:-]|$)/.test(after);
    const atEnd = /[,;]\s*$/.test(before) && /^[!?\.]*$/.test(after);
    return atStart || atEnd;
  }

  function translationTermsFor(value, speakerId = null) {
    const text = String(value || '');
    const occupied = [];
    const terms = [];
    for (const def of translationTermDefs) {
      const regex = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegex(def.source)})(?=$|[^A-Za-z0-9])`, 'gi');
      let match;
      while ((match = regex.exec(text))) {
        const surface = match[2];
        // 普通名詞との衝突を避けるため、全小文字は作品固有語として扱わない。
        if (/[a-z]/.test(surface) && surface === surface.toLowerCase()) continue;
        const start = match.index + match[1].length;
        const end = start + surface.length;
        if (occupied.some(range => start < range.end && end > range.start)) continue;
        occupied.push({ start, end });
        const speakerRendering = def.bySpeaker?.[speakerId] || null;
        const exactJa = speakerRendering?.exactJa || def.exactJa;
        const acceptedJa = [...new Set([
          exactJa,
          def.exactJa,
          ...(speakerRendering?.acceptedJa || []),
          ...(def.acceptedJa || []),
        ])];
        terms.push({
          source: surface,
          exactJa,
          acceptedJa,
          variants: [...new Set([...(def.variants || []), def.source])],
          mustPreserve: def.mustPreserve === true || !isVocativeUse(text, start, end),
          characterId: def.characterId || null,
          start,
        });
      }
    }
    return terms.sort((a, b) => a.start - b.start);
  }

  function outputTermRegex(value, flags = '') {
    const term = String(value || '');
    if (/[A-Za-z0-9]/.test(term)) {
      return new RegExp(`(^|[^A-Za-z0-9])(${escapeRegex(term)})(?=$|[^A-Za-z0-9])`, flags);
    }
    const first = [...term][0] || '';
    const last = [...term].at(-1) || '';
    const beforeClass = /[ァ-ヶー・]/.test(first) ? 'ァ-ヶー・' : /[一-龠々]/.test(first) ? '一-龠々' : '';
    const afterClass = /[ァ-ヶー・]/.test(last) ? 'ァ-ヶー・' : /[一-龠々]/.test(last) ? '一-龠々' : '';
    const before = beforeClass ? `(^|[^${beforeClass}])` : '(^|.)';
    const after = afterClass ? `(?=$|[^${afterClass}])` : '(?=$|.)';
    return new RegExp(`${before}(${escapeRegex(term)})${after}`, flags);
  }

  function containsOutputTerm(text, value) {
    return outputTermRegex(value).test(String(text || ''));
  }

  function outputTermSpans(text, value) {
    const flags = /[A-Za-z]/.test(value) ? 'gi' : 'g';
    const regex = outputTermRegex(value, flags);
    const spans = [];
    let match;
    while ((match = regex.exec(String(text || '')))) {
      const start = match.index + String(match[1] || '').length;
      spans.push({ start, end: start + String(match[2] || '').length });
      if (regex.lastIndex === match.index) regex.lastIndex++;
    }
    return spans;
  }

  function missingPreservedTerms(text, terms) {
    const occupied = [];
    const missingIndexes = new Set();
    const required = terms.map((term, index) => ({ term, index }))
      .filter(item => item.term.mustPreserve)
      // 学校名など長い表記を先に予約し、内側の短い地名へ同じspanを再利用させない。
      .sort((a, b) => Math.max(...b.term.acceptedJa.map(value => value.length)) -
        Math.max(...a.term.acceptedJa.map(value => value.length)) || a.index - b.index);
    for (const { term, index } of required) {
      const candidates = term.acceptedJa
        .flatMap(value => outputTermSpans(text, value).map(span => ({ ...span, length: value.length })))
        .sort((a, b) => b.length - a.length || a.start - b.start);
      const chosen = candidates.find(span =>
        !occupied.some(range => span.start < range.end && span.end > range.start));
      if (chosen) occupied.push(chosen);
      else missingIndexes.add(index);
    }
    return terms.filter((_term, index) => missingIndexes.has(index));
  }

  function canonicalizeTranslation(value, terms = []) {
    let text = String(value || '');
    const corrections = [];
    for (const term of terms) {
      for (const variant of [...(term.variants || [])].sort((a, b) => b.length - a.length)) {
        if (!variant || term.acceptedJa.includes(variant)) continue;
        const flags = /[A-Za-z]/.test(variant) ? 'gi' : 'g';
        const regex = outputTermRegex(variant, flags);
        if (!regex.test(text)) continue;
        regex.lastIndex = 0;
        text = text.replace(regex, (_match, prefix) => `${prefix || ''}${term.exactJa}`);
        corrections.push({ from: variant, to: term.exactJa, source: term.source });
      }
    }
    const missing = missingPreservedTerms(text, terms);
    return { text, corrections, missing };
  }

  const addresseeMatchers = [];
  for (const [id, profile] of Object.entries(profiles)) {
    const aliases = [...new Set([profile.nameEn, ...(profile.aliases || [])])]
      .filter(alias => /[A-Za-z]/.test(alias) && alias.length >= 3)
      .sort((a, b) => b.length - a.length);
    for (const alias of aliases) {
      addresseeMatchers.push({
        id,
        length: alias.length,
        startRegex: new RegExp(
          `^(?:(?:well|oh|look|listen|okay|ok|come\\s+on)\\s*[,!:-]\\s*)?` +
          `(?:hey(?:\\s+there)?[\\s,!-]+)?${escapeRegex(alias)}(?=\\s*(?:[,!?:-]|$))`,
          'i',
        ),
        endRegex: new RegExp(`[,;]\\s*${escapeRegex(alias)}\\s*[!?]*$`, 'i'),
      });
    }
  }
  addresseeMatchers.sort((a, b) => b.length - a.length);

  function explicitAddresseeIds(value, speakerId = null) {
    let text = String(value || '').trimStart();
    const label = labelledSpeaker(text);
    if (label) text = text.slice(label.prefix.length).trimStart();
    const ids = [];
    for (const matcher of addresseeMatchers) {
      if (matcher.id !== speakerId &&
          (matcher.startRegex.test(text) || matcher.endRegex.test(text)) &&
          !ids.includes(matcher.id)) {
        ids.push(matcher.id);
      }
    }
    return ids;
  }

  function resolve(rawSpeaker) {
    const normalized = normalizeName(rawSpeaker);
    const id = aliasToId.get(normalized) || null;
    return id ? { id, profile: profiles[id], raw: String(rawSpeaker || '') }
      : { id: null, profile: null, raw: String(rawSpeaker || '') };
  }

  function decodeEntities(value) {
    return String(value || '')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  }

  function cleanCueText(value) {
    return decodeEntities(String(value || '').replace(/<[^>]*>/g, ''))
      .replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').trim();
  }

  function parseVoiceTags(raw) {
    const matches = [...String(raw || '').matchAll(/<v(?:\.[^\s>]+)*\s+([^>]+)>/gi)];
    if (!matches.length) return [];
    const segments = [];
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i][0].length;
      const next = matches[i + 1]?.index ?? String(raw).length;
      const body = String(raw).slice(start, next).replace(/<\/v\s*>/gi, '');
      const text = cleanCueText(body);
      if (text) segments.push({ speakerRaw: decodeEntities(matches[i][1]).trim(), text });
    }
    return segments;
  }

  function labelledSpeaker(text) {
    const m = String(text || '').match(/^\s*(?:\[([^\]\n]{1,48})\]\s*:?\s*|([A-Za-z][A-Za-z0-9 .’'_-]{0,47})\s*:\s*)/);
    const raw = (m?.[1] || m?.[2] || '').trim();
    return raw && resolve(raw).id ? { raw, prefix: m[0] } : null;
  }

  function parseCue(cue) {
    const raw = String(cue?.text || '');
    let text = '';
    let segments = [];

    // ChromeのWebVTTパーサーを優先。<v Name> は span[title="Name"] になる。
    try {
      const fragment = cue?.getCueAsHTML?.();
      if (fragment) {
        text = String(fragment.textContent || '').trim();
        const voiceNodes = [...fragment.querySelectorAll('span[title]')];
        segments = voiceNodes.map(node => ({
          speakerRaw: String(node.getAttribute('title') || '').trim(),
          text: String(node.textContent || '').trim(),
        })).filter(segment => segment.text);
      }
    } catch (e) { /* raw WebVTTへフォールバック */ }

    if (!segments.length) segments = parseVoiceTags(raw);
    if (!text) text = cleanCueText(raw);

    let speakerRaw = null;
    let speakerSource = 'unknown';
    if (segments.length === 1) {
      speakerRaw = segments[0].speakerRaw;
      speakerSource = 'vtt';
    } else if (segments.length > 1) {
      const unique = [...new Set(segments.map(s => normalizeName(s.speakerRaw)).filter(Boolean))];
      if (unique.length === 1) speakerRaw = segments[0].speakerRaw;
      speakerSource = unique.length === 1 ? 'vtt' : 'multi';
    } else {
      const labelled = labelledSpeaker(text);
      if (labelled) {
        speakerRaw = labelled.raw;
        speakerSource = 'label';
        // 話者ラベルはメタデータとして保持し、翻訳対象の台詞からは除く。
        text = text.slice(labelled.prefix.length).trimStart();
      }
    }

    const resolved = resolve(speakerRaw);
    const normalizedSegments = segments.map(segment => {
      const r = resolve(segment.speakerRaw);
      return { ...segment, speakerId: r.id };
    });
    return {
      text,
      speakerRaw,
      speakerId: resolved.id,
      speakerSource,
      segments: normalizedSegments,
    };
  }

  function promptProfiles(ids) {
    const wanted = [...new Set((ids || []).filter(id => profiles[id]))];
    if (!wanted.length) return '明示話者なし。普通の会話は簡潔な常体を既定にし、明確な根拠なしに敬語や特定人物の口癖を足さない。';
    const entries = wanted.map(id => {
      const p = profiles[id];
      const relations = Object.entries(p.addresses || {})
        .map(([target, name]) => `${profiles[target]?.nameJa || target}を「${name}」と呼ぶ`).join('、');
      const rules = (p.addressRules || []).join('、');
      const sample = p.sample?.replace(/[。、]/g, ' ').replace(/\s{2,}/g, ' ').trim();
      const examples = (p.examples || []).map(example =>
        `${example.register || 'context'}「${example.en}」→「${example.ja}」`).join(' / ');
      const styleExample = examples || (sample ? `「${sample}」` : '');
      return `- ${id} (${p.nameJa}, ${socialGroup(id)}): ${p.voice} 性格: ${p.traits}${relations ? ` 呼称: ${relations}` : ''}${rules ? ` 呼称ルール: ${rules}` : ''}${styleExample ? ` 訳調例: ${styleExample}` : ''}`;
    }).join('\n');
    return `共通: 子供同士・友達同士は常体が既定。呼称は原文に呼びかけ・名前・愛称がある時だけ使い、原文にない名前や口癖を足さない。\n${entries}`;
  }

  return {
    PROFILE_VERSION, profiles, normalizeName, resolve, parseCue, promptProfiles,
    socialGroup, registerPolicy, explicitAddresseeIds,
    translationTermsFor, canonicalizeTranslation,
    _test: { cleanCueText, parseVoiceTags, labelledSpeaker },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SPJS_CHARACTERS;
