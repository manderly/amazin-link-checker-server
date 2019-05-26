module.exports = {
  tags: ['default'],
  'Step one: page is properly formed' : function (client) {
    client
      .url('localhost:8080')
      .waitForElementVisible('body', 1000)
      .assert.title('Amazin\' Affiliate Link Checker')
      .assert.visible('#link-checker-title')
      .assert.visible('#enter-tag')
      .assert.visible('#enter-key-id')
      .assert.visible('#enter-secret')
      .assert.visible('#enter-url')
      .assert.visible('#button-submit-form')
  },

  'Step two: page rejects empty form fields' : function (client) {
    client
      .waitForElementVisible('#button-submit-form')
      .click('#button-submit-form')
      .pause(1000)
      .assert.cssClassPresent('#enter-tag', 'is-invalid')
      .assert.cssClassPresent('#enter-key-id', 'is-invalid')
      .assert.cssClassPresent('#enter-secret', 'is-invalid')
      .assert.cssClassPresent('#enter-url', 'is-invalid')
  },
  'Step three: form rejects URL without http(s) protocol, clears error once http:// or https:// is included' : function (client) {
    client
      .setValue('#enter-url', 'test.com')
      .click('#button-submit-form')
      .pause(500)
      .assert.cssClassPresent('#enter-url', 'is-invalid')
      .clearValue('#enter-url')
      .setValue('#enter-url', 'http://not-so-secure-blog.com')
      .click('#button-submit-form')
      .pause(500)
      .assert.cssClassNotPresent('#enter-url', 'is-invalid')
      .clearValue('#enter-url')
      .setValue('#enter-url', 'https://super-secure-blog.com')
      .click('#button-submit-form')
      .pause(500)
      .assert.cssClassNotPresent('#enter-url', 'is-invalid')
  },

  'Step four: page accepts a form with filled-in fields and a URL with https://' : function (client) {
    client
      .setValue('#enter-tag', 'test-tag')
      .setValue('#enter-key-id', 'TEST-KEY-ID')
      .setValue('#enter-secret', 'TEST-SECRET')
      .setValue('#enter-url', 'https://link-checker-test.com')
      .click('#button-submit-form')
      .pause(500)
      .assert.cssClassNotPresent('#enter-tag', 'is-invalid')
      .assert.cssClassNotPresent('#enter-key-id', 'is-invalid')
      .assert.cssClassNotPresent('#enter-secret', 'is-invalid')
      .assert.cssClassNotPresent('#enter-url', 'is-invalid')
      .end();
  }
};
