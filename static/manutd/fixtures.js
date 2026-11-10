// Single fixture source for every page (hub, season, trips, squad, match).
// Dates/times from the club's official fixtures page, checked 10 Nov 2026, stored as UTC.
// conf:true  = kick-off confirmed (Premier League TV picks announced, or a UEFA date).
// conf:false = provisional: the original Premier League slot, which may move once that month's TV picks are announced
//              (January picks are normally announced mid-November, and so on month by month).
// sales (optional) = ticket windows: [{what, opens?, closes?, who?}] in UTC, from tickets.manutd.com. They drive the
//              calendar's ticket events and the 'ticket deadline' push alerts, so keep them current when a sale or ballot is announced.
// The API-Football feed is used for ids, scores and status only; where it still shows a provisional slot, this file wins.
window.MU_FIXTURES=[
{
"opp": "Chelsea",
"comp": "Premier League",
"ko": "2026-10-31T12:30:00Z",
"home": false,
"venue": "Stamford Bridge",
"col": "#034694",
"conf": true
},
{
"opp": "Roma",
"comp": "Champions League",
"ko": "2026-11-03T20:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": true
},
{
"opp": "Aston Villa",
"comp": "Premier League",
"ko": "2026-11-08T16:30:00Z",
"home": true,
"venue": "Old Trafford",
"conf": true
},
{
"opp": "Liverpool",
"comp": "Premier League",
"ko": "2026-11-22T16:30:00Z",
"home": false,
"venue": "Anfield",
"col": "#C8102E",
"conf": true
},
{
"opp": "Sporting CP",
"comp": "Champions League",
"ko": "2026-11-25T20:00:00Z",
"home": false,
"venue": "Estádio José Alvalade",
"col": "#008056",
"conf": true
},
{
"opp": "Brentford",
"comp": "Premier League",
"ko": "2026-11-28T15:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": true
},
{
"opp": "Newcastle United",
"comp": "Premier League",
"ko": "2026-12-02T20:15:00Z",
"home": false,
"venue": "St. James' Park",
"col": "#241F20",
"conf": true,
"sales": [
{
"what": "Away ballot",
"closes": "2026-11-04T08:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Coventry City",
"comp": "Premier League",
"ko": "2026-12-05T15:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": true
},
{
"opp": "RB Leipzig",
"comp": "Champions League",
"ko": "2026-12-08T20:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": true
},
{
"opp": "Crystal Palace",
"comp": "Premier League",
"ko": "2026-12-13T19:00:00Z",
"home": false,
"venue": "Selhurst Park",
"col": "#1B458F",
"conf": true,
"sales": [
{
"what": "Away ballot",
"opens": "2026-11-13T08:00:00Z",
"closes": "2026-11-18T08:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Arsenal",
"comp": "Premier League",
"ko": "2026-12-20T16:30:00Z",
"home": false,
"venue": "Emirates Stadium",
"col": "#EF0107",
"conf": true,
"sales": [
{
"what": "Away ballot",
"opens": "2026-11-20T08:00:00Z",
"closes": "2026-11-25T08:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Nottingham Forest",
"comp": "Premier League",
"ko": "2026-12-27T16:30:00Z",
"home": true,
"venue": "Old Trafford",
"conf": true
},
{
"opp": "Sunderland",
"comp": "Premier League",
"ko": "2026-12-30T19:30:00Z",
"home": true,
"venue": "Old Trafford",
"conf": true
},
{
"opp": "Brighton & Hove Albion",
"comp": "Premier League",
"ko": "2027-01-02T12:30:00Z",
"home": false,
"venue": "American Express Stadium",
"col": "#0057B8",
"conf": true,
"sales": [
{
"what": "Away ballot",
"opens": "2026-12-04T08:00:00Z",
"closes": "2026-12-09T08:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Newcastle United",
"comp": "Premier League",
"ko": "2027-01-07T20:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": true
},
{
"opp": "Aston Villa",
"comp": "Premier League",
"ko": "2027-01-16T15:00:00Z",
"home": false,
"venue": "Villa Park",
"col": "#670E36",
"conf": false,
"sales": [
{
"what": "Away ballot",
"opens": "2026-12-18T08:00:00Z",
"closes": "2026-12-21T08:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Bayern München",
"comp": "Champions League",
"ko": "2027-01-20T20:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": true
},
{
"opp": "Liverpool",
"comp": "Premier League",
"ko": "2027-01-23T15:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": false,
"sales": [
{
"what": "Members' ballot",
"closes": "2026-11-11T08:00:00Z",
"who": "Official Members, Season Ticket Holders, Executive Club"
}
]
},
{
"opp": "Villarreal",
"comp": "Champions League",
"ko": "2027-01-27T20:00:00Z",
"home": false,
"venue": "Estadio de la Cerámica",
"col": "#FFE667",
"conf": true,
"sales": [
{
"what": "Members' away ballot",
"opens": "2026-12-17T08:00:00Z",
"closes": "2026-12-22T08:00:00Z",
"who": "Executive Club, Season Ticket Holders, Official Members"
}
]
},
{
"opp": "Brentford",
"comp": "Premier League",
"ko": "2027-01-30T15:00:00Z",
"home": false,
"venue": "Gtech Community Stadium",
"col": "#E30613",
"conf": false,
"sales": [
{
"what": "Away ballot",
"opens": "2027-01-01T08:00:00Z",
"closes": "2027-01-06T08:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Chelsea",
"comp": "Premier League",
"ko": "2027-02-06T15:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": false,
"sales": [
{
"what": "Members' ballot",
"closes": "2026-11-17T08:00:00Z",
"who": "Official Members"
}
]
},
{
"opp": "Brighton & Hove Albion",
"comp": "Premier League",
"ko": "2027-02-10T20:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": false
},
{
"opp": "Nottingham Forest",
"comp": "Premier League",
"ko": "2027-02-20T15:00:00Z",
"home": false,
"venue": "The City Ground",
"col": "#DD0000",
"conf": false,
"sales": [
{
"what": "Away ballot",
"opens": "2027-01-22T08:00:00Z",
"closes": "2027-01-27T08:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Arsenal",
"comp": "Premier League",
"ko": "2027-02-27T15:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": false,
"sales": [
{
"what": "Members' ballot",
"closes": "2026-11-24T08:00:00Z",
"who": "Official Members"
}
]
},
{
"opp": "Sunderland",
"comp": "Premier League",
"ko": "2027-03-03T20:00:00Z",
"home": false,
"venue": "Stadium of Light",
"col": "#EB172B",
"conf": false,
"sales": [
{
"what": "Away ballot",
"opens": "2027-01-29T08:00:00Z",
"closes": "2027-02-03T08:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Everton",
"comp": "Premier League",
"ko": "2027-03-13T15:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": false
},
{
"opp": "Manchester City",
"comp": "Premier League",
"ko": "2027-03-20T15:00:00Z",
"home": false,
"venue": "Etihad Stadium",
"col": "#6CABDD",
"conf": false,
"sales": [
{
"what": "Away ballot",
"opens": "2027-02-19T08:00:00Z",
"closes": "2027-02-24T08:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Hull City",
"comp": "Premier League",
"ko": "2027-04-10T14:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": false
},
{
"opp": "Ipswich Town",
"comp": "Premier League",
"ko": "2027-04-17T14:00:00Z",
"home": false,
"venue": "Portman Road",
"col": "#0E00F7",
"conf": false,
"sales": [
{
"what": "Away ballot",
"opens": "2027-03-19T08:00:00Z",
"closes": "2027-03-24T08:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Crystal Palace",
"comp": "Premier League",
"ko": "2027-04-24T14:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": false
},
{
"opp": "Coventry City",
"comp": "Premier League",
"ko": "2027-05-01T14:00:00Z",
"home": false,
"venue": "Coventry Building Society Arena",
"col": "#78D0F1",
"conf": false,
"sales": [
{
"what": "Away ballot",
"opens": "2027-04-02T07:00:00Z",
"closes": "2027-04-07T07:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "AFC Bournemouth",
"comp": "Premier League",
"ko": "2027-05-08T14:00:00Z",
"home": false,
"venue": "Vitality Stadium",
"col": "#DA291C",
"conf": false,
"sales": [
{
"what": "Away ballot",
"opens": "2027-04-09T07:00:00Z",
"closes": "2027-04-14T07:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Leeds United",
"comp": "Premier League",
"ko": "2027-05-15T14:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": false
},
{
"opp": "Tottenham Hotspur",
"comp": "Premier League",
"ko": "2027-05-23T14:00:00Z",
"home": false,
"venue": "Tottenham Hotspur Stadium",
"col": "#132257",
"conf": false,
"sales": [
{
"what": "Away ballot",
"opens": "2027-04-23T07:00:00Z",
"closes": "2027-04-28T07:00:00Z",
"who": "Executive Club, Season Ticket Holders (Silver level and above who bought all home cup games)"
}
]
},
{
"opp": "Fulham",
"comp": "Premier League",
"ko": "2027-05-30T15:00:00Z",
"home": true,
"venue": "Old Trafford",
"conf": false
}
];
