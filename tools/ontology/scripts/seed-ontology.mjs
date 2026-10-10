import {mkdir,writeFile} from 'node:fs/promises';
const dirs=['references/character','references/creature','references/armor','references/clothing','references/materials','references/environment','references/lighting','references/camera','ontology/raw','ontology/definitions','ontology/species','ontology/archetypes','ontology/morphology','ontology/cultures','ontology/professions','ontology/classes','ontology/roles','ontology/ranks','ontology/states','ontology/modifiers','ontology/equipment','ontology/animation-profiles','blender/archetypes','blender/components','blender/materials','blender/rigs','blender/scenes','blender/scripts','public/assets/entities','public/assets/equipment','public/assets/animations','public/assets/materials','generated/previews','generated/turntables','generated/manifests','src/debug'];
for(const dir of dirs){await mkdir(dir,{recursive:true});await writeFile(`${dir}/.gitkeep`,'');}
const json=async(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
const raw=`Humans
Elves
Dark Elves / Drow
High Elves
Wood Elves
Dwarves
Gnomes
Halflings
Orcs
Half-Orcs
Goblins
Hobgoblins
Bugbears
Trolls
Ogres
Giants
Cyclopes
Beastkin
Catfolk
Wolfkin
Foxfolk / Kitsune
Lizardfolk
Dragonborn / Draconians
Merfolk
Naga
Centaurs
Minotaurs
Satyrs / Fauns
Fairies / Fae
Pixies
Dryads
Elementals
Spirits
Ghosts
Wraiths
Specters
Skeletons
Zombies
Ghouls
Vampires
Liches
Death Knights
Revenants
Necromancers
Werewolves
Shapeshifters
Demons
Devils
Imps
Succubi / Incubi
Demon Lords
Angels
Archangels
Fallen Angels
Gods
Demigods
Avatars
Titans
Primordials
Dragons
Wyverns
Drakes
Hydras
Basilisks
Cockatrices
Griffins
Hippogriffs
Pegasi
Unicorns
Phoenixes
Chimeras
Manticores
Gargoyles
Golems
Animated Armor
Living Weapons
Mimics
Slimes
Oozes
Giant Spiders
Giant Insects
Insectoids
Ratfolk
Kobolds
Gnolls
Treants
Fungal Creatures
Plant Monsters
Swarm Entities
Hive Minds
Parasites
Mutants
Aberrations
Eldritch Beings
Cosmic Horrors
Void Creatures
Shadow Creatures
Dream Entities
Doppelgängers
Possessors
Aliens
Ancient Aliens
Precursors
Synthetic Lifeforms
Androids
Robots
Drones
War Machines
Mechs
Cyborgs
Augmented Humans
Clones
Gene-Warriors
AI
Sentient AI
Rogue AI
Machine Minds
Digital Entities
Uploaded Humans
Holographic Beings
Nanite Swarms
Grey Goo
Biomechanical Creatures
Living Ships
Space Beasts
Energy Beings
Plasma Entities
Psionic Beings
Telepaths
Psychics
Empaths
Time Travelers
Temporal Entities
Dimensional Travelers
Extradimensional Beings
Reality Warpers
Ascended Beings
Immortals
Cultivators
Mana Beasts
Spirit Beasts
Divine Beasts
Dungeon Monsters
Dungeon Bosses
World Bosses
Raid Bosses
Elite Monsters
Named Monsters
Legendary Creatures
Evolving Monsters
Familiars
Summons
Contracted Beasts
Tamed Monsters
Mounts
Constructs
Homunculi
Chimeric Experiments
Artificial Souls
Soul-Bound Entities
Avatars of the System
System Administrators
Guides
Quest Givers
Merchants
Trainers
Companions
Followers
Minions
NPCs
Awakened NPCs
Players
Reincarnators
Transmigrators
Returners
Regressors
Chosen Ones
Heroes
Dark Lords
Demon Kings
Overlords
Warlords
Kings and Queens
Emperors
Guild Masters
Adventurers
Mercenaries
Knights
Paladins
Warriors
Barbarians
Rogues
Assassins
Rangers
Hunters
Monks
Mages
Wizards
Sorcerers
Warlocks
Clerics
Druids
Summoners
Enchanters
Illusionists
Alchemists
Artificers
Psions
Technomancers
Spellswords
Battlemages
Necro-Tech Entities
Magitech Constructs
Arcane AI
Cybernetic Mages
Star Gods
Planetary Minds
World Spirits
World Trees
Dungeon Cores
World Cores
System Cores
Conceptual Entities
Personifications
Embodiments
Outer Gods
Multiversal Entities
Creators
Destroyers
Transcendent Entities`.split('\n');
if(raw.length!==230)throw Error('Vocabulary must contain 230 entries');
const categories={
 species:'1-2,6-31,47-50,52,58,60-70,72,80-85,101',
 subspecies:'3-5,10,12,30,48-50,61-62,102',
 biological_archetypes:'1-31,60-72,78-91,99,112-113,123,125,140-142,157-158,219',
 artificial_archetypes:'73-76,104-109,114-124,156-159,212-214,220-222',
 monster_families:'14-17,32,38-39,47-50,60-88,91,93-96,123,125,140-143',
 supernatural_states:'33-43,45-46,54,92,97,100,110-111,119-120,126-128,133,137-138,140-142,160,171',
 transformations:'34-46,54,71,92,99-100,110-113,119,137,150,158,173-176',
 professions:'44,139,162-166,185-188,193-195,204,206-207,209',
 classes:'42,44,128-131,139,178,186-211,215',
 social_roles:'51,53,55-57,103,108,124,162-172,177-189,228-229',
 progression_rank:'51,53,55-56,59,137-139,147-150,171,177-181,230',
 encounter_classifications:'143-150',
 ai_classifications:'90,104-109,114-119,121-122,162,214,217,222',
 cosmic_classifications:'55-59,94-98,125-128,133,135-138,216-230',
 entity_relationships:'57,89-91,100,112,151-155,160-161,167-169,177',
 system_litrpg:'139-155,160-178,186,220-222',
 visual_modifiers:'3,10,16-17,21,23-30,32,34-43,45,47-54,71,73-79,80-82,86-89,92,96-99,104-111,120-123,126-128,137,140-142,150,158,212-215',
 metaphysical_concepts:'32-36,43,46-59,90,94-100,114-120,126-138,159-161,173-177,216-230'
};
const expand=s=>new Set(s.split(',').flatMap(x=>{const [a,b]=x.split('-').map(Number);return Array.from({length:(b??a)-a+1},(_,i)=>a+i);}));
const sets=Object.fromEntries(Object.entries(categories).map(([k,v])=>[k,expand(v)]));
const vocabulary=raw.map((term,i)=>({index:i+1,term,categories:Object.entries(sets).filter(([,s])=>s.has(i+1)).map(([k])=>k),interpretation:'Provisional multi-label classification; canonical world rules decide meaning.'}));
if(vocabulary.some(x=>!x.categories.length))throw Error('Unclassified entry');
await json('ontology/raw/vocabulary.json',vocabulary);
await writeFile('ontology/raw/RAW_ENTITY_VOCABULARY.md','# Raw entity vocabulary\n\nOriginal user vocabulary, preserved verbatim. Not a species registry.\n\n'+raw.map((x,i)=>`${i+1}. ${x}`).join('\n')+'\n');
await writeFile('ontology/raw/CLASSIFICATION.md','# Vocabulary classification\n\nThese labels are editorial hypotheses, not simulation facts. Entries can inhabit several dimensions. Vampire is normally a state on a biological species; boss is an encounter role; merchant is a profession; culture is orthogonal to species. Names such as Drow can include biology and culture: the simulation adapter must disambiguate.\n\n| # | Original term | Dimensions |\n|---|---|---|\n'+vocabulary.map(x=>`| ${x.index} | ${x.term} | ${x.categories.join(', ')} |`).join('\n')+'\n');
const archetypes=['humanoid_standard','humanoid_heavy','humanoid_small','dwarf_humanoid','beast_humanoid','giant_humanoid','quadruped','dragon','winged_creature','insectoid','serpentine','amorphous','construct','skeletal','ethereal','cosmic_abstract'];
await json('ontology/archetypes/index.json',archetypes.map(id=>({id,status:'MISSING',requirements:['Reference-approved geometry','Rig profile and deformation review']})));
const specs=[['human','humanoid_standard',1.75,'humanoid_standard','quaternius-human'],['elf','humanoid_standard',1.85,'humanoid_standard'],['dwarf','dwarf_humanoid',1.35,'humanoid_small'],['orc','humanoid_heavy',2.05,'humanoid_large'],['goblin','humanoid_small',1.15,'humanoid_small'],['wolfkin','beast_humanoid',1.9,'humanoid_standard'],['skeleton','skeletal',1.75,'humanoid_standard'],['golem','construct',2.7,'construct'],['slime','amorphous',0.8,'amorphous'],['dragon','dragon',3.5,'dragon'],['android','construct',1.8,'humanoid_standard']];
await json('ontology/species/index.json',specs.map(([id,archetype,height,rig,body])=>({id,name:id[0].toUpperCase()+id.slice(1),archetype,rigFamily:rig,defaultHeightM:height,headFamily:`${id}:head`,features:({elf:['pointed_ears'],orc:['tusks'],wolfkin:['muzzle','fur','tail'],dragon:['wings','scales','tail'],skeleton:['exposed_bones']})[id]??[],materialFamily:`${id}:surface`,...(body?{bodyAssetId:body}:{}),requirements:['Torn Veil art direction review',...(body?[]:[`Species silhouette and components: ${id}`])]})));
const entities=[...specs.slice(0,7).map(s=>s[0]),'vampire',...specs.slice(7).map(s=>s[0])].map((id,i)=>({schemaVersion:1,id:`${id}_001`,name:id[0].toUpperCase()+id.slice(1),appearanceSeed:415294+i,biological:{species:id==='vampire'?'human':id,origin:['android','golem'].includes(id)?'artificial':'biological',sex:['human','orc','dwarf'].includes(id)?'male':'unspecified',age:id==='human'?43:42,bodyType:id==='orc'?'heavy':'standard'},social:{culture:id==='orc'?'northern':'dunmere',profession:({human:'farmer',orc:'blacksmith',dwarf:'artificer',goblin:'merchant'})[id]??'wanderer'},gameplay:{rank:i%2?'silver':'bronze',equipment:[]},states:id==='vampire'?['vampiric']:id==='skeleton'?['undead']:[],modifiers:[]}));
await json('ontology/definitions/validation-entities.json',entities);
await json('ontology/states/index.json',[{id:'vampiric',materialFamily:'vampiric:pale',effects:['eye_accent'],requirements:['Vampiric skin/eyes/teeth not yet implemented']},{id:'undead',effects:[],requirements:['Undead visual-state review']},...['cybernetic','mutated','possessed','divine','demonic','corrupted','ascended','ethereal'].map(id=>({id,effects:[],requirements:[`State component authoring: ${id}`]}))]);
await json('ontology/art-direction.json',{id:'torn-veil-unset',version:1,status:'UNSET',referenceIds:[],humanoidProportions:{headsTall:null,shoulderToHeight:null},polygonBudget:{hero:null,crowd:null,lodRatios:[]},textureDensity:{pixelsPerMeter:null,maxResolution:null},stylization:null,materialRules:{roughnessRange:null,metallicPolicy:null},silhouetteRules:[],colorRules:{palette:[],saturationRange:null},faceRules:{},handRules:{scale:null},armorRules:[],clothingRules:[],monsterLanguage:[],presentation:{gameCameraDistanceM:null,lightingReference:null}});
await json('ontology/cultures/index.json',['dunmere','northern','imperial','underground'].map(id=>({id,status:'UNSET',clothing:[],armor:[],jewelry:[],hairstyles:[],weaponPreferences:[],materials:[],colors:[],adornments:[],architecture:[],speciesRestrictions:[]})));
for(const [dim,ids]of Object.entries({professions:['farmer','blacksmith','merchant','artificer','wanderer'],classes:['warrior','mage','ranger','paladin'],roles:['quest_giver','companion','guild_master'],ranks:['bronze','silver','gold'],modifiers:['scarred','horned','winged','cybernetic']}))await json(`ontology/${dim}/index.json`,ids.map(id=>({id,visualRequirements:[`Author ${id} visual rules`]})));
await json('ontology/animation-profiles/index.json',['humanoid_standard','humanoid_small','humanoid_large','quadruped','winged_quadruped','dragon','serpentine','insectoid','construct','amorphous'].map(id=>({id:`${id}:base`,rigFamily:id,vocabulary:['idle','walk','run','turn','interact','attack','hit','death'],mappingStatus:'UNMAPPED',socketNames:['head','hand_r','hand_l','back'],rootMotionPolicy:'simulation_driven'})));
await json('ontology/equipment/slots.json',['head','face','neck','torso_inner','torso_outer','shoulders','hands','waist','legs','feet','back','main_hand','off_hand','accessory_1','accessory_2']);
console.log('Created 230 vocabulary entries, 16 archetypes, 12 validation entities.');
