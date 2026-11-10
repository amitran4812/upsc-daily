"""'Why it matters for UPSC': India-centred analysis of a news item, dimension by dimension.

Each entry links a recurring news theme (a neighbour, a security issue, an economic lever...)
to what it means for India under the GS dimensions UPSC asks about: international relations,
internal security, economy, governance, environment, society, science & tech, ethics.
These are used when no AI key is set; with a key, the AI writes item-specific analysis
(see ai.NOTES_PROMPT) and these remain as a fallback. Only matched themes are shown, so an
item with no clear India angle gets no analysis rather than generic filler.
"""
import re

IR, SEC, ECO, GOV, ENV, SOC, ST, ETH, GEO = ("International relations", "Internal security", "Economy",
                                            "Governance & polity", "Environment", "Society",
                                            "Science & tech", "Ethics", "Geography & disasters")

ANGLES = [
    # ---------- Neighbourhood ----------
    {"keys": ["bangladesh", "dhaka", "hasina", "yunus"], "theme": "India–Bangladesh",
     "angles": [(IR, "Test of Neighbourhood First and Act East: Bangladesh is India's largest trade partner in South Asia and the gateway for connectivity to the North-East (Chittagong and Mongla port access, BBIN)."),
                (SEC, "India's longest land border (~4,096 km) is porous: illegal migration, cattle and fake-currency smuggling, and North-East insurgent groups that have used Bangladeshi territory. Instability in Dhaka or anti-India sentiment directly affects border management (BSF, fencing, Smart Fencing/CIBMS)."),
                (GOV, "Water and land issues: Ganga Water Treaty (1996, 30 years, due for renewal in 2026), Teesta water sharing, and the Land Boundary Agreement 2015 (100th Constitutional Amendment).")]},
    {"keys": ["extradit"], "theme": "Extradition and asylum",
     "angles": [(GOV, "Extradition in India is governed by the Extradition Act, 1962 and bilateral treaties; most treaties (e.g. India–Bangladesh 2013, amended 2016) exclude offences of a 'political character', so the request becomes a legal and diplomatic judgement."),
                (IR, "Handing over or sheltering a political figure signals India's stance towards the government in power next door; a refusal can strain ties, while handing over can hurt India's image as a safe haven for allies."),
                (ETH, "Balances rule of law and treaty obligations against humanitarian concerns (fair trial, death penalty, non-refoulement). India is not party to the 1951 Refugee Convention but follows non-refoulement in practice.")]},
    {"keys": ["pakistan", "islamabad", "rawalpindi", "loc ", "line of control"], "theme": "India–Pakistan",
     "angles": [(SEC, "Cross-border terrorism and infiltration across the LoC remain India's core security concern; links to J&K, drones dropping arms/drugs in Punjab, and terror financing (FATF)."),
                (IR, "India's stated policy: no talks with terror; Indus Waters Treaty (1960) held in abeyance since April 2025; China–Pakistan nexus including CPEC through PoK.")]},
    {"keys": ["china", "beijing", "xi jinping", "lac ", "line of actual control", "galwan"], "theme": "India–China",
     "angles": [(SEC, "Unsettled LAC (eastern Ladakh, Arunachal): border infrastructure, disengagement and buffer zones; China's dual-use villages (Xiaokang) and dams on the Brahmaputra (Yarlung Tsangpo)."),
                (ECO, "Large trade deficit and dependence on Chinese inputs (APIs, electronics, solar, rare earths) drive PLI schemes, Press Note 3 (2020) FDI curbs and supply-chain diversification."),
                (IR, "Strategic competition in the Indian Ocean (String of Pearls), BRI vs connectivity alternatives (IMEC), and balancing via Quad while engaging in BRICS/SCO.")]},
    {"keys": ["nepal", "kathmandu"], "theme": "India–Nepal",
     "angles": [(IR, "Open border under the 1950 Treaty of Peace and Friendship; map dispute over Kalapani–Lipulekh–Limpiyadhura; competition with Chinese investment."),
                (SEC, "Open border can be misused for trafficking, fake currency and movement of criminals; SSB guards it."),
                (ECO, "Hydropower trade (India buys Nepali power), cross-border rail and petroleum pipelines.")]},
    {"keys": ["sri lanka", "colombo", "katchatheevu"], "theme": "India–Sri Lanka",
     "angles": [(IR, "Chinese presence (Hambantota port, research vessels) is a strategic concern; India's economic aid in the 2022 crisis; 13th Amendment and Tamil reconciliation."),
                (SEC, "Fishermen issue in the Palk Strait and Katchatheevu (ceded 1974) affects Tamil Nadu politics and maritime security.")]},
    {"keys": ["maldives", "malé"], "theme": "India–Maldives",
     "angles": [(IR, "Maldives sits on key sea lanes near Lakshadweep; India is first responder (Operation Cactus 1988, water crisis 2014, COVID aid) while China courts Malé."),
                (SEC, "Maritime domain awareness, Colombo Security Conclave and the Indian Ocean as India's strategic backyard (SAGAR / MAHASAGAR).")]},
    {"keys": ["myanmar", "rohingya", "arakan", "rakhine"], "theme": "India–Myanmar",
     "angles": [(SEC, "1,643 km border with the North-East; Free Movement Regime (the Centre decided in 2024 to end it and fence the border), refugee inflows into Mizoram and Manipur, insurgent camps and drug trafficking (Golden Triangle)."),
                (IR, "Act East connectivity: Kaladan Multi-modal project (Sittwe port) and the India–Myanmar–Thailand Trilateral Highway depend on stability in Rakhine and Chin areas.")]},
    {"keys": ["afghanistan", "taliban", "kabul"], "theme": "India–Afghanistan",
     "angles": [(SEC, "Risk of terror groups using Afghan soil against India; drug trafficking (Golden Crescent)."),
                (IR, "India's pragmatic engagement with the Taliban, humanitarian aid, and Chabahar-based access that bypasses Pakistan.")]},
    {"keys": ["bhutan", "thimphu", "doklam"], "theme": "India–Bhutan",
     "angles": [(IR, "Closest partner in the neighbourhood; hydropower cooperation (Chukha, Tala, Mangdechhu); Bhutan–China boundary talks matter because of Doklam."),
                (SEC, "Doklam plateau is close to the Siliguri Corridor ('Chicken's Neck'), India's link to the North-East.")]},

    # ---------- Major powers & regions ----------
    {"keys": ["trump", "washington", "united states", "u.s.", "us tariff", "white house"], "theme": "India–US",
     "angles": [(ECO, "US is India's largest export market; tariffs, H-1B visa rules and trade-deal talks hit IT services, textiles, gems and pharma exports and the rupee."),
                (IR, "Comprehensive Global Strategic Partnership: defence deals, iCET/TRUST technology cooperation, Quad; India balances this with strategic autonomy (Russian oil, BRICS).")]},
    {"keys": ["russia", "putin", "moscow", "ukraine", "kyiv", "zelensky"], "theme": "Russia–Ukraine and India",
     "angles": [(IR, "India's strategic autonomy: abstentions at the UN, call for dialogue and diplomacy, while keeping ties with Russia and the West."),
                (ECO, "Discounted Russian crude, fertiliser and defence spares; Western sanctions and secondary tariffs create payment and trade risks for India."),
                (SEC, "Dependence on Russian defence equipment (S-400, Su-30) and the push for indigenisation (Atmanirbhar Bharat in defence).")]},
    {"keys": ["iran", "tehran", "israel", "gaza", "hamas", "hezbollah", "west asia", "middle east", "red sea"], "theme": "West Asia conflict and India",
     "angles": [(ECO, "India imports most of its crude oil, much of it from the Gulf; conflict raises oil prices, shipping and insurance costs, inflation and the current account deficit."),
                (SOC, "About 9 million Indians live in the Gulf; their safety (evacuation operations such as Ajay/Kaveri) and remittances (India is the world's largest recipient) are at stake."),
                (IR, "India balances ties with Israel, Iran and the Arab states; projects like Chabahar and IMEC depend on regional stability.")]},
    {"keys": ["saudi", "uae", "emirates", "qatar", "gulf cooperation"], "theme": "India–Gulf",
     "angles": [(ECO, "Energy security, strategic petroleum reserves, Gulf investment (sovereign funds) and the India–UAE CEPA (2022)."),
                (SOC, "Large Indian diaspora and remittances; labour welfare issues (kafala system).")]},
    {"keys": ["canada", "khalistan", "nijjar"], "theme": "India–Canada",
     "angles": [(SEC, "Pro-Khalistan extremism abroad and its links to violence in Punjab; India seeks action against designated terrorists."),
                (IR, "Diplomatic expulsions and trade-talk freezes; large Indian student and diaspora population in Canada.")]},
    {"keys": ["apec", "asean", "indo-pacific", "south china sea", "philippines", "taiwan"], "theme": "Indo-Pacific",
     "angles": [(IR, "India's Act East Policy and vision of a free, open, rules-based Indo-Pacific (UNCLOS 1982); Quad and ASEAN centrality."),
                (ECO, "A large share of India's trade passes through the Malacca Strait and South China Sea; disruption hits supply chains (semiconductors from Taiwan).")]},

    # ---------- Internal security ----------
    {"keys": ["terror", "uapa", "nia ", "jaish", "lashkar", "isis", "terror module"], "theme": "Terrorism",
     "angles": [(SEC, "Shows the threat from cross-border and home-grown terror modules, online radicalisation and terror financing; NIA and the UAPA, 1967 are the main legal and investigative tools."),
                (GOV, "Debate on UAPA's stringent bail provisions, low conviction rate and civil liberties versus security.")]},
    {"keys": ["maoist", "naxal", "left-wing extremism", "bastar", "dantewada"], "theme": "Left-wing extremism",
     "angles": [(SEC, "The Centre set March 2026 as its deadline to end LWE; security operations plus surrender-and-rehabilitation policies; number of affected districts has fallen sharply."),
                (GOV, "Root causes are governance deficits: land alienation, forest rights (FRA 2006, PESA 1996), lack of roads, schools and mobile connectivity in tribal areas.")]},
    {"keys": ["manipur", "nagaland", "mizoram", "assam rifles", "afspa", "insurgen", "kuki", "meitei"], "theme": "North-East security",
     "angles": [(SEC, "Ethnic conflict and insurgency in the North-East, porous Myanmar border, arms and drug trafficking; AFSPA, 1958 in 'disturbed areas'."),
                (GOV, "Peace accords (Bodo 2020, Karbi 2021, NLFT 2024) and the role of Article 371 special provisions and Sixth Schedule councils.")]},
    {"keys": ["jammu and kashmir", "j&k", "kashmir", "ladakh"], "theme": "J&K and Ladakh",
     "angles": [(SEC, "Infiltration, hybrid terrorists and narco-terror links; normalcy indicators such as tourism and voter turnout."),
                (GOV, "After the abrogation of Article 370 (2019, upheld by the Supreme Court in 2023), questions of statehood restoration and Sixth Schedule demands in Ladakh.")]},
    {"keys": ["cyber", "ransomware", "digital arrest", "hacker", "data breach", "phishing"], "theme": "Cyber security",
     "angles": [(SEC, "Cyber attacks on critical infrastructure and fraud like 'digital arrest' scams; CERT-In, NCIIPC and I4C are the response agencies."),
                (GOV, "IT Act 2000, Digital Personal Data Protection Act 2023, and the need for cyber hygiene and capacity in state police.")]},
    {"keys": ["drone", "narco", "drug traffick", "heroin", "methamphetamine"], "theme": "Drugs and border crime",
     "angles": [(SEC, "Narco-terror links across the Punjab border (Golden Crescent) and in the North-East (Golden Triangle); drones are used to drop drugs and arms."),
                (SOC, "Drug abuse among youth; NDPS Act, 1985 and Nasha Mukt Bharat Abhiyaan.")]},
    {"keys": ["coast guard", "navy", "maritime security", "piracy", "indian ocean"], "theme": "Maritime security",
     "angles": [(SEC, "Protecting sea lanes, coastal security after 26/11, anti-piracy patrols in the Arabian Sea and Gulf of Aden; India as net security provider in the IOR."),
                (IR, "SAGAR / MAHASAGAR vision, Information Fusion Centre (IOR) at Gurugram, and naval diplomacy.")]},

    # ---------- Economy ----------
    {"keys": ["crude", "oil price", "brent", "opec"], "theme": "Oil prices",
     "angles": [(ECO, "India imports over 85% of its crude oil; higher prices widen the current account deficit, weaken the rupee and push up inflation and the subsidy bill."),
                (IR, "Diversifying suppliers (Russia, US, Guyana) and building strategic petroleum reserves (Visakhapatnam, Mangaluru, Padur).")]},
    {"keys": ["tariff", "trade deal", "free trade agreement", "fta", "wto", "export"], "theme": "Trade policy",
     "angles": [(ECO, "Affects India's export competitiveness, MSMEs and jobs in labour-intensive sectors; India's recent FTAs include UAE, Australia, EFTA (TEPA) and the UK."),
                (IR, "Trade is now a tool of geopolitics; India defends policy space at the WTO on food security (public stockholding) and agriculture.")]},
    {"keys": ["rbi", "repo", "monetary policy", "inflation", "cpi"], "theme": "Monetary policy and prices",
     "angles": [(ECO, "RBI's MPC targets 4% CPI inflation (±2%); rate decisions affect EMIs, credit growth, investment and the rupee."),
                (SOC, "Food inflation hits poor households the most; links to supply-side measures like buffer stocks and export curbs.")]},
    {"keys": ["gdp", "growth rate", "fiscal deficit", "gst", "budget"], "theme": "Growth and public finance",
     "angles": [(ECO, "Shows the health of the economy and fiscal space for capex and welfare; FRBM targets and centre–state revenue sharing (Finance Commission, GST Council)."),
                (GOV, "Cooperative fiscal federalism: GST Council (Article 279A) and states' demands for a larger share of the divisible pool.")]},
    {"keys": ["critical mineral", "rare earth", "lithium", "semiconductor", "chip"], "theme": "Strategic supply chains",
     "angles": [(ECO, "India depends on imports (largely China) for rare earths, lithium and chips needed for EVs, electronics and defence; National Critical Mineral Mission and India Semiconductor Mission respond to this."),
                (IR, "Partnerships such as the Minerals Security Partnership, Quad and KABIL's overseas mines aim to de-risk supply chains.")]},
    {"keys": ["unemployment", "jobs", "plfs", "labour code", "gig worker"], "theme": "Employment",
     "angles": [(ECO, "Jobs for a young workforce decide whether India reaps its demographic dividend; PLFS tracks the labour force participation rate."),
                (SOC, "Rising gig and platform work needs social security (Code on Social Security 2020); low female labour force participation remains a gap.")]},
    {"keys": ["farmer", "msp", "kharif", "rabi", "fertiliser", "fertilizer", "procurement"], "theme": "Agriculture",
     "angles": [(ECO, "Agriculture employs about 45% of workers; MSP, procurement and input prices affect farm incomes, food inflation and the subsidy bill."),
                (GOV, "Debates on MSP legal guarantee, crop diversification away from water-intensive paddy, and agricultural marketing reforms.")]},

    # ---------- Governance & polity ----------
    {"keys": ["election commission", "electoral roll", "voter list", "sir ", "special intensive revision", "evm"], "theme": "Elections",
     "angles": [(GOV, "Free and fair elections are part of the basic structure; ECI's powers under Article 324, voter-roll revisions and the balance between cleaning rolls and avoiding exclusion of genuine voters."),
                (SOC, "Exclusion risk for migrants, the poor and women who lack documents.")]},
    {"keys": ["governor", "article 200", "assent", "federalism", "centre-state"], "theme": "Centre–state relations",
     "angles": [(GOV, "Role of the Governor in withholding assent to state bills (Article 200, 201) and Supreme Court guidance on timelines; tests cooperative federalism."),
                (ETH, "Constitutional morality: holders of constitutional office are expected to act neutrally and in good faith.")]},
    {"keys": ["supreme court", "high court", "judgment", "verdict"], "theme": "Judiciary",
     "angles": [(GOV, "Judicial review and the separation of powers; such rulings often clarify fundamental rights or federal relations and become Mains examples."),
                (SOC, "Access to justice and pendency (over 5 crore cases) affect citizens' trust in institutions.")]},
    {"keys": ["corruption", "lokpal", "enforcement directorate", "money laundering", "pmla", "cbi"], "theme": "Probity",
     "angles": [(GOV, "Anti-corruption institutions (Lokpal, CBI, ED under PMLA 2002) and debates on their independence and misuse."),
                (ETH, "Probity in public life, accountability and transparency (GS4 case-study material).")]},

    # ---------- Environment, disasters, society, S&T ----------
    {"keys": ["climate", "cop3", "cop 3", "unfccc", "emission", "net zero", "carbon"], "theme": "Climate change",
     "angles": [(ENV, "India's NDCs (45% cut in emission intensity of GDP from 2005 levels by 2030, 50% non-fossil power capacity, net zero by 2070) and the principle of CBDR-RC."),
                (IR, "India speaks for the Global South on climate finance and technology transfer; carbon border taxes like the EU's CBAM affect Indian exports.")]},
    {"keys": ["air quality", "pollution", "aqi", "stubble", "smog"], "theme": "Air pollution",
     "angles": [(ENV, "Air pollution is a public-health emergency in North India; NCAP, GRAP and the Commission for Air Quality Management (2021) are the policy tools."),
                (GOV, "Needs inter-state coordination (Punjab, Haryana, Delhi) and alternatives to stubble burning such as Happy Seeder and bio-decomposers.")]},
    {"keys": ["cyclone", "flood", "landslide", "earthquake", "heatwave", "cloudburst", "ndrf", "disaster"], "theme": "Disaster management",
     "angles": [(GEO, "India is exposed to cyclones, floods and heatwaves; the Disaster Management Act, 2005 (amended 2025), NDMA and NDRF/SDRF lead the response."),
                (GOV, "Shift from relief to risk reduction (Sendai Framework); early warning, CDRI and climate-resilient infrastructure.")]},
    {"keys": ["tiger", "elephant", "wildlife", "species", "forest", "mangrove", "wetland", "ramsar"], "theme": "Biodiversity",
     "angles": [(ENV, "Conservation under the Wildlife (Protection) Act 1972 and Forest Conservation Act 1980; India's commitments under the CBD (30x30 target)."),
                (SOC, "Human–wildlife conflict and the rights of forest dwellers under the Forest Rights Act 2006.")]},
    {"keys": ["women", "gender", "dowry", "sexual harassment", "posh"], "theme": "Women and gender",
     "angles": [(SOC, "Women's safety, workforce participation and representation (Women's Reservation Act 2023, one-third seats after delimitation)."),
                (GOV, "Laws such as the POSH Act 2013 and the new criminal laws (BNS 2023) and their implementation gaps.")]},
    {"keys": ["caste", "census", "reservation", "obc", "scheduled tribe", "tribal"], "theme": "Social justice",
     "angles": [(SOC, "Data and policy for social justice: the next Census will include caste enumeration; sub-classification of SC/ST (Supreme Court 2024) and the 50% ceiling (Indra Sawhney)."),
                (GOV, "Targeting welfare and reservation policy needs reliable data; also linked to delimitation.")]},
    {"keys": ["isro", "gaganyaan", "satellite", "chandrayaan", "space mission", "space station"], "theme": "Space",
     "angles": [(ST, "India's space programme (Gaganyaan, Chandrayaan, NavIC) and the 2023 Space Policy opening the sector to private firms (IN-SPACe)."),
                (SEC, "Space is now a strategic domain: surveillance satellites, anti-satellite capability (Mission Shakti 2019) and the Defence Space Agency.")]},
    {"keys": [" ai ", "artificial intelligence", "deepfake", "chatbot"], "theme": "Artificial intelligence",
     "angles": [(ST, "IndiaAI Mission (2024) for compute, datasets and indigenous models; India hosted the AI Impact Summit in 2026."),
                (ETH, "Deepfakes, bias, privacy and accountability call for responsible-AI rules and platform obligations under the IT Rules.")]},
    {"keys": ["vaccine", "antimicrobial", "tuberculosis", "malaria", "anaemia", "outbreak", "world health organization"], "theme": "Public health",
     "angles": [(SOC, "Public health outcomes and out-of-pocket spending; schemes like Ayushman Bharat PM-JAY and the TB-elimination target."),
                (GOV, "Health is a State subject; centre–state coordination and the One Health approach for disease surveillance.")]},
]

# keys match at the start of a word ("iran" also matches "Iranian"); a trailing space in a key
# means it must also end there (e.g. "sir ", " ai ").
_compiled = [(a, [re.compile(r"(?<![a-z])" + re.escape(k)) for k in a["keys"]]) for a in ANGLES]


def india_angles(title, body="", limit_themes=2, limit_angles=4):
    """Return {'themes': [...], 'angles': [{'dim','point'}]} for the themes the news mentions.
    Themes named in the headline come first, then those only in the text."""
    tt, tb = " " + (title or "").lower() + " ", " " + (body or "").lower() + " "
    hits = []
    for i, (a, pats) in enumerate(_compiled):
        if any(p.search(tt) for p in pats):
            hits.append((0, i, a))
        elif any(p.search(tb) for p in pats):
            hits.append((1, i, a))
    themes, angles, seen = [], [], set()
    for _, _, a in sorted(hits, key=lambda h: h[:2])[:limit_themes]:
        themes.append(a["theme"])
        for dim, point in a["angles"]:
            if dim not in seen or len(angles) < 2:
                angles.append({"dim": dim, "point": point})
                seen.add(dim)
    return {"themes": themes, "angles": angles[:limit_angles]} if angles else None
