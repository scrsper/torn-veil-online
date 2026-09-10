# Durable design decisions

## Generative Universe Kernel v0.1

- Each canonical `World` owns its material/component/process definitions under a scoped ruleset id. There is no global invention registry or new finished-device ItemType. This is an extension boundary for differing future rulesets, not a multiple-universe implementation.
- Mechanical power, work and labor rates use physical seconds, J, W, kg and metres. Calendar event timestamps retain world seconds. Existing grain/flour measures are mapped to explicit mass units at the legacy stock adapter.
- v0.1 connects typed ports in bounded linear acyclic graphs. General branching, fluid dynamics and energy regeneration are deferred. Finite environmental input and explicit losses prevent feedback energy creation.
- Component capabilities, actual instances and inhabitants' knowledge remain separate. Invention uses ordinary goal utility, planning/actions, knowledge/memory and conversation; a successful recipe is observed instance-independent topology, not an authored device lookup. Receiving instructions neither creates objects nor grants skill.
- Relevant constitutional authority consulted: sections 5–6 (epistemics), 10 (motivation), 33 (universe architecture), 47 (clocks), 61 (discovery), and 65 (composition). Evidence and limitations: `docs/GENERATIVE_UNIVERSE_KERNEL.md`.
