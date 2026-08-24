/**
 * Ereignistexte, deutsch.
 *
 * Jedes Ereignis hat einen Titel, eine Beschreibung und je Option einen Text,
 * der die Konsequenz benennt — nicht bloß die Handlung. "Zustimmen" ist keine
 * Entscheidung, "Zustimmen: +60 % Gehalt, die anderen wollen jetzt auch" schon.
 */

import type { TemplateSet } from "./engine.ts";

export const EVENT_TEMPLATES: TemplateSet = {
  // ── Kader ───────────────────────────────────────────────────────────────
  "squad.contract_demand.title": ["{player} fordert einen neuen Vertrag"],
  "squad.contract_demand.body": [
    "Vier starke Spiele in Folge, und sein Berater weiß es. Gefordert werden 60 Prozent mehr Gehalt.",
    "{player} spielt stark und sein Berater hat gerechnet: 60 Prozent Aufschlag oder Gespräche mit anderen.",
  ],
  "squad.contract_demand.accept": ["Zustimmen — er bleibt zufrieden, aber die anderen sehen es"],
  "squad.contract_demand.negotiate": ["Verhandeln — 60 Prozent Chance auf einen Kompromiss"],
  "squad.contract_demand.refuse": ["Ablehnen — Geld gespart, Stimmung riskiert"],

  "squad.dressing_room_row.title": ["Streit in der Kabine um {player}"],
  "squad.dressing_room_row.body": [
    "{player} verdient mehr als alle anderen zusammen und lässt es die Mannschaft spüren. Die Kabine ist gespalten.",
    "Nach dem Training ist es laut geworden. {player} und die halbe Mannschaft stehen sich gegenüber.",
  ],
  "squad.dressing_room_row.back_star": ["Hinter {player} stellen — die Mannschaft nimmt es übel"],
  "squad.dressing_room_row.back_squad": ["Hinter die Mannschaft stellen — {player} ist gekränkt"],
  "squad.dressing_room_row.stay_out": ["Sich heraushalten — beide Seiten sind unzufrieden"],

  "squad.training_injury.title": ["{player} verletzt sich im Training"],
  "squad.training_injury.body": [
    "Ein unglücklicher Zweikampf im Abschlusstraining. {player} fällt {matchdays} Spieltage aus.",
    "{player} bleibt im Training liegen. Diagnose: {matchdays} Spieltage Pause.",
  ],

  "squad.form_surge.title": ["{player} spielt sich in den Vordergrund"],
  "squad.form_surge.body": [
    "{player} ist seit Wochen der Beste auf dem Platz. Die Presse fragt, ob er befördert wird.",
  ],
  "squad.form_surge.promote": ["Öffentlich loben — er blüht auf, die anderen weniger"],
  "squad.form_surge.keep_calm": ["Auf dem Boden halten — schützt das Klima, bremst ihn"],

  "squad.veteran_doubt.title": ["{player} zweifelt an seiner Rolle"],
  "squad.veteran_doubt.body": [
    "{player} ist der Älteste im Kader und merkt, dass die Einsatzzeiten weniger werden. Er will Klarheit.",
  ],
  "squad.veteran_doubt.guarantee_place": ["Stammplatz zusichern — die Fans lieben es, der Kader nicht"],
  "squad.veteran_doubt.offer_farewell": ["Abschied anbieten — ehrlich, aber die Fans reagieren empfindlich"],
  "squad.veteran_doubt.no_promise": ["Nichts versprechen — er nimmt es persönlich"],

  "squad.youngster_pushes.title": ["{player} fordert Einsatzzeit"],
  "squad.youngster_pushes.body": [
    "{player} ist der Jüngste im Kader und will spielen. Sein Berater erwähnt beiläufig andere Vereine.",
  ],
  "squad.youngster_pushes.give_minutes": ["Einsatzzeit geben — er entwickelt sich, andere rücken zurück"],
  "squad.youngster_pushes.loan_out": ["Verleihen — 400k jetzt, aber er fehlt acht Spieltage"],
  "squad.youngster_pushes.wait": ["Vertrösten — er verliert Motivation und an Wert"],

  // ── Wirtschaft ──────────────────────────────────────────────────────────
  "economy.sponsor_offer.title": ["Ein Zusatzsponsor klopft an"],
  "economy.sponsor_offer.body": [
    "Zwei Angebote liegen auf dem Tisch: eines zahlt sehr gut und ist bei euren Fans verhasst, das andere ist unauffällig.",
    "Ein Wettanbieter bietet das Dreifache — und eure Ultras haben bereits ein Transparent vorbereitet.",
  ],
  "economy.sponsor_offer.take_lucrative": ["Das große Angebot nehmen — 9,0 Mio, die Fans kochen"],
  "economy.sponsor_offer.take_modest": ["Das kleine nehmen — 3,5 Mio, kaum Widerstand"],
  "economy.sponsor_offer.decline": ["Beide ablehnen — kein Geld, aber Haltung"],

  "economy.tax_bill.title": ["Steuernachzahlung"],
  "economy.tax_bill.body": [
    "Das Finanzamt hat die letzten Transferabwicklungen geprüft. Fällig sind {amount}.",
    "Eine Nachforderung über {amount} liegt im Briefkasten. Zahlbar sofort.",
  ],

  "economy.merch_boom.title": ["Die Trikots verkaufen sich"],
  "economy.merch_boom.body": [
    "Der Fanshop meldet Rekordzahlen. Man könnte nachlegen — oder es dabei belassen.",
  ],
  "economy.merch_boom.push_hard": ["Nachlegen — 3,0 Mio, die Fans finden es aufdringlich"],
  "economy.merch_boom.moderate": ["Maß halten — 1,2 Mio, niemand beschwert sich"],

  "economy.loan_offer.title": ["Die Bank bietet einen Kredit"],
  "economy.loan_offer.body": [
    "Eure Hausbank hat ein Angebot vorbereitet. Zinsen fallen erst in der nächsten Saison an.",
  ],
  "economy.loan_offer.take_large": ["25 Mio aufnehmen — Handlungsfreiheit gegen Schulden"],
  "economy.loan_offer.take_small": ["10 Mio aufnehmen — vorsichtig"],
  "economy.loan_offer.decline": ["Ablehnen — schuldenfrei bleiben"],

  // ── Fans ────────────────────────────────────────────────────────────────
  "fans.ticket_protest.title": ["Die Ultras fordern niedrigere Preise"],
  "fans.ticket_protest.body": [
    "Ein offener Brief hängt am Stadiontor. Der Ton ist deutlich.",
    "Die aktive Fanszene kündigt Stimmungsboykott an, falls sich nichts ändert.",
  ],
  "fans.ticket_protest.lower_prices": ["Preise senken — teuer, aber die Kurve steht wieder"],
  "fans.ticket_protest.meet_ultras": ["Zum Gespräch einladen — kleine Geste, kleine Wirkung"],
  "fans.ticket_protest.ignore": ["Aussitzen — kostet Stimmung und Anhänger"],

  "fans.choreo_request.title": ["Die Kurve plant eine Choreografie"],
  "fans.choreo_request.body": [
    "Für das nächste Heimspiel ist etwas Großes geplant. Es fehlt nur das Geld.",
  ],
  "fans.choreo_request.fund": ["Finanzieren — 800k für ein Bild, das bleibt"],
  "fans.choreo_request.decline": ["Ablehnen — spart Geld, kostet Wohlwollen"],

  "fans.loyalty_action.title": ["Die Fans stellen sich hinter den Verein"],
  "fans.loyalty_action.body": [
    "Trotz der Ergebnisse war die Kurve am Wochenende voll und laut. Das bleibt nicht ohne Wirkung.",
    "Ein Fanclub organisiert eine Solidaritätsaktion. Die Mannschaft bedankt sich sichtlich gerührt.",
  ],

  // ── Stadion ─────────────────────────────────────────────────────────────
  "stadium.pitch_damage.title": ["Der Rasen ist hinüber"],
  "stadium.pitch_damage.body": [
    "Nach drei Spielen an einem Tag sieht das Spielfeld aus wie ein Acker. Der Platzwart hat einen Kostenvoranschlag dabei.",
  ],
  "stadium.pitch_damage.full_repair": ["Neu verlegen — 2,5 Mio, dann ist Ruhe"],
  "stadium.pitch_damage.patch": ["Ausbessern — 700k, hält eine Weile"],
  "stadium.pitch_damage.play_on": ["So weiterspielen — kostenlos, aber die Beine merken es"],

  "stadium.storm_damage.title": ["Sturmschaden am Stadion"],
  "stadium.storm_damage.body": [
    "Das Dach über der Gegengerade hat es erwischt. Die Behörde will einen Plan sehen.",
  ],
  "stadium.storm_damage.repair_now": ["Vollständig sanieren — teuer, aber erledigt"],
  "stadium.storm_damage.minimal": ["Notdürftig sichern — billig, und das sieht man"],

  // ── Markt ───────────────────────────────────────────────────────────────
  "market.poach_offer.title": ["Angebot für {player}"],
  "market.poach_offer.body": [
    "Ein Verein aus dem Ausland bietet 30 Mio für {player}. Die Anfrage ist ernst gemeint.",
    "{player} hat ein Angebot auf dem Tisch: 30 Mio Ablöse, und sein Berater drängt.",
  ],
  "market.poach_offer.sell": ["Verkaufen — 30 Mio, die Fans werden es nicht vergessen"],
  "market.poach_offer.demand_more": ["Nachfordern — 45 Prozent Chance auf 42 Mio"],
  "market.poach_offer.refuse": ["Ablehnen — die Fans jubeln, {player} nicht"],

  "market.agent_call.title": ["Ein Berater meldet sich"],
  "market.agent_call.body": [
    "Er will 600k für ein Gespräch. Angeblich hat er einen lukrativen Deal für euch — in der Hälfte der Fälle stimmt so etwas sogar.",
    "Ein Vermittler bietet an, einen Abnehmer zu besorgen. Vorkasse 600k, Erfolg ungewiss.",
  ],
  "market.agent_call.listen": ["Anhören — 600k Vorkasse, 50 Prozent Chance auf 2,5 Mio"],
  "market.agent_call.hang_up": ["Auflegen"],

  "market.rival_interest.title": ["{rival} interessiert sich für {player}"],
  "market.rival_interest.body": [
    "Aus der Liga selbst kommt eine Anfrage. {rival} will {player} — und wird nicht lockerlassen.",
    "{rival} hat sich nach {player} erkundigt. In dieser Liga bleibt so etwas nicht geheim.",
  ],
  "market.rival_interest.open_talks": ["Gespräche öffnen — {player} freut sich, die Fans nicht"],
  "market.rival_interest.raise_price": ["Preis hochsetzen — er wird teurer und ärgerlich"],
  "market.rival_interest.block": ["Abblocken — die Fans stehen hinter dir, {player} nicht"],

  // ── Boulevard ───────────────────────────────────────────────────────────
  "tabloid.interview_slip.title": ["{player} redet sich um Kopf und Kragen"],
  "tabloid.interview_slip.body": [
    "In einem Interview hat {player} die Fans, die Taktik und beiläufig auch dich kritisiert.",
    "{player} hat gesagt, was er denkt. Das Problem ist, was er denkt.",
  ],
  "tabloid.interview_slip.apologise": ["Öffentlich entschuldigen — die Fans beruhigen sich"],
  "tabloid.interview_slip.fine_player": ["Geldstrafe — 250k in die Kasse, Stimmung in der Kabine dahin"],
  "tabloid.interview_slip.back_him": ["Rückendeckung geben — er dankt es dir, die Fans nicht"],

  "tabloid.rumour.title": ["Gerüchte um {player}"],
  "tabloid.rumour.body": [
    "Angeblich soll {player} bereits mit einem anderen Verein gesprochen haben. Belege gibt es keine.",
    "Ein Boulevardblatt will wissen, dass {player} unzufrieden ist. Der Verein dementiert.",
  ],
};
