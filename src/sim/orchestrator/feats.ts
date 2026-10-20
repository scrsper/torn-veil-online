/**
 * Feats: John Smith's recognitions. After Dungeon Crawler Carl, the archive notices what someone
 * does, names it and remarks on it; unlike a scripted achievement list, every feat is a threshold
 * over counters that only canonical events move (see `watch.ts`). The same table applies to every
 * person. A feat's tier is the cache it asks the finite reserve for; only interface holders can
 * receive one, and a recognition of opening caches asks for none, so the reserve never feeds itself.
 */
export type FeatGroup = 'combat' | 'tower' | 'veil' | 'arcana' | 'society' | 'archive';
export interface Feat {
  id: string; name: string; group: FeatGroup;
  /** Cache tier requested from the reserve (0 Bronze .. 5 Celestial). */
  tier: number;
  /** False when the feat only recognizes: it asks the reserve for nothing. */
  reward: boolean;
  counter: string; at: number;
  line: string;
  /** What the archive will say about an unearned feat: a nudge, not a spoiler. */
  hint: string;
}
const F = (id: string, name: string, group: FeatGroup, tier: number, counter: string, at: number, line: string, hint: string): Feat => ({ id, name, group, tier, reward: counter !== 'cachesOpened', counter, at, line, hint });

export const FEATS: readonly Feat[] = Object.freeze([
  // Combat. Counters come from canonical attack/kill/surrender events.
  F('first-contact', 'Contact Established', 'combat', 0, 'blows', 1, 'First blow logged. The archive notes you have opinions and the means to express them.', 'Land a blow on someone.'),
  F('first-down', 'First Down', 'combat', 0, 'downs', 1, 'Someone hit the ground because of you. They got up again, probably. The archive has no strong feelings.', 'Put an opponent on the ground.'),
  F('downs-10', 'Ten Grounded', 'combat', 1, 'downs', 10, 'Ten opponents grounded. You are developing a technique, or a reputation. Possibly both.', 'Ground ten opponents.'),
  F('downs-50', 'Floor Plan', 'combat', 2, 'downs', 50, 'Fifty grounded. At this point the floor is part of your strategy.', 'Ground fifty opponents.'),
  F('downs-200', 'Attrition Is a Strategy', 'combat', 3, 'downs', 200, 'Two hundred. The archive has stopped writing their names in full.', 'Ground two hundred opponents.'),
  F('first-kill', 'Irreversible', 'combat', 1, 'kills', 1, 'Someone stopped. The archive keeps their file open anyway. It keeps everyone\'s.', 'End a life.'),
  F('beast', 'Apex, Provisionally', 'combat', 0, 'beastKills', 1, 'An animal died at your hand. The food chain has been informed.', 'Bring down a wild animal.'),
  F('tenderized', 'Tenderized', 'combat', 1, 'blowsTaken', 100, 'One hundred blows received. Pain is information. You are extremely well informed.', 'Take a great many blows and keep standing.'),
  F('practical', 'Practical Metaphysics', 'combat', 1, 'arcaneHits', 10, 'Ten strikes delivered by something other than your hands. The universe has opinions about that. So do you.', 'Strike with a learned form.'),
  F('discretion', 'Discretion', 'combat', 0, 'surrenders', 1, 'You yielded. The archive records survival as a legitimate strategy and declines to comment further.', 'Live to fight another day.'),
  // The Tower of Chrysanthus.
  F('tower-door', 'Through the Door', 'tower', 0, 'towerEntries', 1, 'You walked into the Tower. Most people only look at it. The Tower, for its part, looked back.', 'Enter the shared Tower trial.'),
  F('floor-1', 'Floor One, As Advertised', 'tower', 0, 'floorsCleared', 1, 'First trial cleared. The wardens agreed to this. You should know they meant it.', 'Clear a Tower floor.'),
  F('floor-5', 'Getting Taller', 'tower', 1, 'highestFloor', 5, 'Floor five. The view is improving. The wardens are not.', 'Reach floor five.'),
  F('floor-10', 'Double Digits', 'tower', 2, 'highestFloor', 10, 'Floor ten. Statistically, most climbers are now somewhere else, being remembered.', 'Reach floor ten.'),
  F('floor-25', 'Quarter Ascent', 'tower', 3, 'highestFloor', 25, 'Floor twenty-five. The Tower has begun budgeting for you specifically.', 'Reach floor twenty-five.'),
  F('floor-50', 'Halfway to Somewhere', 'tower', 3, 'highestFloor', 50, 'Floor fifty. The archive would like it noted that it never doubted you. It did.', 'Reach floor fifty.'),
  F('floor-75', 'The Thin Air', 'tower', 4, 'highestFloor', 75, 'Floor seventy-five. Few files reach this drawer.', 'Reach floor seventy-five.'),
  F('floor-100', 'Chrysanthus', 'tower', 5, 'highestFloor', 100, 'The summit floor, cleared. The Tower has nothing left to teach you, and it is a little afraid.', 'Clear the hundredth floor.'),
  F('untouched', 'Untouched', 'tower', 1, 'flawlessFloors', 1, 'A trial cleared without taking a single blow. Show-off. Logged.', 'Clear a floor without being hit.'),
  F('choreographed', 'Choreographed', 'tower', 3, 'flawlessFloors', 5, 'Five untouched floors. The wardens are filing a complaint about your footwork.', 'Clear five floors without being hit.'),
  F('margin', 'Margin of Error', 'tower', 1, 'nearDeathClears', 1, 'Cleared on a sliver of vitality. The archive had already started your obituary. It keeps drafts.', 'Clear a floor with almost nothing left.'),
  F('fallen', 'Gravity Won', 'tower', 0, 'falls', 1, 'A climb ended. The Tower keeps the receipt. So does the archive.', 'Fall in the Tower.'),
  F('award', 'Finders, Rightful', 'tower', 0, 'awardsClaimed', 1, 'You took what the trial owed you. The paperwork says it is yours. The paperwork is very confident.', 'Claim a sealed award.'),
  // The Veil and the wider world.
  F('veil', 'Across the Veil', 'veil', 0, 'crossings', 1, 'You crossed between realms. The Veil does not usually let things through. It made an exception, which it will not discuss.', 'Cross the Veil.'),
  F('commuter', 'Commuter', 'veil', 1, 'crossings', 10, 'Ten crossings. The Veil now recognizes your footsteps and sighs.', 'Cross the Veil ten times.'),
  F('wards', 'Ward Walker', 'veil', 2, 'wardsBest', 4, 'Every ward of a realm walked. You now know it better than its maps do. Its maps are not very good.', 'Walk all four wards of one realm.'),
  F('two-skies', 'Under Two Skies', 'veil', 3, 'realmsWalked', 2, 'Every ward of both realms. You are, for filing purposes, local everywhere.', 'Walk every ward of both realms.'),
  F('wayfarer', 'Wayfarer', 'veil', 1, 'landmarks', 5, 'Five places of note visited. The archive appreciates a traveller who reads the signs.', 'Visit places of note you have seen.'),
  F('cartographer', 'Cartographer', 'veil', 2, 'landmarks', 15, 'Fifteen places of note. You could draw this world from memory, badly.', 'Visit fifteen places of note.'),
  // Arcana and growth. Read from canonical learning/cast/advancement events only.
  F('literate', 'Literate in the Strange', 'arcana', 1, 'sourcesLearned', 1, 'You learned a form from a source. Reading: still the most dangerous thing a person can do.', 'Learn a form from a book or essence.'),
  F('polyglot', 'Polyglot of Forms', 'arcana', 2, 'sourcesLearned', 3, 'Three forms learned. The archive suspects you of studying.', 'Learn three forms.'),
  F('library', 'Library of One', 'arcana', 3, 'sourcesLearned', 6, 'Six forms. You are now a small, mobile, slightly flammable library.', 'Learn six forms.'),
  F('habitual', 'Habitual Miracles', 'arcana', 1, 'casts', 25, 'Twenty-five castings. What was a wonder is now a habit. The universe is adjusting.', 'Cast twenty-five times.'),
  F('iron', 'Iron', 'arcana', 1, 'stage', 1, 'Advancement recorded: Iron. Capability first, label second, as the constitution prefers.', 'Advance beyond Normal.'),
  F('bronze', 'Bronze', 'arcana', 2, 'stage', 2, 'Advancement recorded: Bronze. The archive has upgraded your drawer.', 'Advance to Bronze.'),
  F('silver', 'Silver', 'arcana', 3, 'stage', 3, 'Advancement recorded: Silver. Kingdoms have been founded by less.', 'Advance to Silver.'),
  F('gold', 'Gold', 'arcana', 4, 'stage', 4, 'Advancement recorded: Gold. The archive is, against its training, impressed.', 'Advance to Gold.'),
  // Society. These are the deeds that make a person matter without a weapon.
  F('honest-hands', 'Honest Hands', 'society', 1, 'returned', 1, 'You returned something that was not yours. The archive files this under rare.', 'Return something to its owner.'),
  F('lost-and-found', 'Lost and Found Department', 'society', 2, 'returned', 5, 'Five returns. People have started losing things near you on purpose.', 'Return five things to their owners.'),
  F('generous', 'Generosity Detected', 'society', 0, 'gifts', 1, 'You gave something away. The archive checked twice.', 'Give something away.'),
  F('patron', 'Patron', 'society', 1, 'gifts', 10, 'Ten gifts. Somebody, somewhere, is writing you into their family stories.', 'Give ten gifts.'),
  F('mender', 'Mender', 'society', 1, 'heals', 1, 'You tended someone\'s wounds. History rarely remembers this. The archive does.', 'Tend someone\'s wounds.'),
  F('light-fingers', 'Light Fingers', 'society', 0, 'thefts', 1, 'Theft logged. The archive does not judge. Other people will.', 'Take what is not yours.'),
  F('due-process', 'Due Process', 'society', 0, 'arrested', 1, 'You were arrested. Institutions exist. You have now met one.', 'Be taken into custody.'),
  F('maker', 'Maker', 'society', 1, 'crafted', 1, 'Something exists now that did not before, and you made it. The archive approves of new entries.', 'Craft something.'),
  F('square', 'Square', 'society', 0, 'debtsPaid', 1, 'A debt settled. The ledger balances. The archive is briefly, quietly happy.', 'Settle a debt.'),
  // The archive itself: quests, caches, attention and renown. Holder-only counters.
  F('settled', 'Matter Settled', 'archive', 0, 'questsCompleted', 1, 'Your first open matter, closed. The archive likes you a little more than it is allowed to.', 'Close an open matter.'),
  F('reliable', 'Reliable', 'archive', 1, 'questsCompleted', 10, 'Ten matters closed. Reliability is a kind of power. It is just very boring to watch.', 'Close ten matters.'),
  F('institution', 'Institution', 'archive', 2, 'questsCompleted', 40, 'Forty matters closed. You are no longer a person who solves problems. You are where problems go.', 'Close forty matters.'),
  F('unboxing', 'Unsealed', 'archive', 0, 'cachesOpened', 1, 'Your first cache, opened. The archive watched you do it. The archive watches everything you do. That is the arrangement.', 'Open a cache.'),
  F('hoarder', 'Hoarder Instincts', 'archive', 1, 'cachesOpened', 10, 'Ten caches. The reserve is finite. You are aware of this. You opened them anyway.', 'Open ten caches.'),
  F('watched', 'Under Observation', 'archive', 1, 'attention', 2, 'You now rate a closer watch. Nothing personal. Everything you do is now slightly more personal.', 'Become someone worth watching.'),
  F('followed', 'Followed', 'archive', 2, 'attention', 3, 'The archive follows your file now. You have, technically, an audience.', 'Become someone worth following.'),
  F('case-study', 'Case Study', 'archive', 3, 'attention', 4, 'You are being studied. Do not let it go to your head. It is already in your file.', 'Become historically significant.'),
  F('fixation', 'Fixation', 'archive', 4, 'attention', 5, 'The archive cannot look away. This has happened very few times. It is not always good news.', 'Become impossible to ignore.'),
  F('talked-about', 'Talked About', 'archive', 1, 'renown', 10, 'Ten people carry a memory of something you did. Gossip is a form of immortality with poor fact-checking.', 'Be remembered by ten people.'),
  F('known-quantity', 'Known Quantity', 'archive', 2, 'renown', 40, 'Forty minds hold a deed of yours. You are a story people tell now. Some of it is even true.', 'Be remembered by forty people.'),
  F('household-name', 'Household Name', 'archive', 3, 'renown', 100, 'A hundred minds. Somewhere a child is pretending to be you. Badly, the archive hopes.', 'Be remembered by a hundred people.'),
]);
export const FEAT_BY_ID: ReadonlyMap<string, Feat> = new Map(FEATS.map(f => [f.id, f]));
