const id = process.env.WXM_UCCX_SURVEY_ID
const username = process.env.WXM_UCCX_USERNAME
const password = process.env.WXM_UCCX_PASSWORD

const questionIds = {
  name: '5ed8902332291125c80bf520',
  email: '5ed8904e5d45d8ba9054e203',
  phone: '5ed8907032291125c80bf561',
  nps: '5e81dafdb33a2d1970935673',
  ces: '5e81dafdb33a2d1970935674',
  touchpoint: '602a6e8c0e00e419a8ddaa64'
}

module.exports = {
  id,
  username,
  password,
  questionIds
}