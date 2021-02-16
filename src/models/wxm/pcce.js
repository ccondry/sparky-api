const id = process.env.WXM_PCCE_SURVEY_ID
const username = process.env.WXM_PCCE_USERNAME
const password = process.env.WXM_PCCE_PASSWORD

const questionIds = {
  name: '5ed5e86b05ea951d04e13fcc',
  email: '5ed5e8925d45dac8d858e145',
  phone: '5ed5e8c005ea951d04e1403f',
  nps: '5e81dd9b1a7d1c1b147cfd92',
  ces: '5e81dd9b1a7d1c1b147cfd93',
  touchpoint: '602a6a280e00e419a8dda5e6',
  customerId: '5e81dd9b1a7d1c1b147cfd80',
  agentId: '5e81dd9b1a7d1c1b147cfd84',
  teamId: '5e81dd9b1a7d1c1b147cfd85'
}

module.exports = {
  id,
  username,
  password,
  questionIds
}