'use strict';

const o = require('../common');
describe('functional: create channel retries', function() {
  it('should retry on failure', function(done) {
    let create;
    const provider = o.rmq({newInstance: true});
    return o.co(function* coroutine() {
      provider.config.reChannelAfter = 200;
      // const clock = o.sinon.useFakeTimers();
      yield provider._connect(false);
      create = o.sinon.stub(provider.connection, 'createConfirmChannel', function(cb) {
        cb('error', null);
      });
      yield provider._channel(false);
      create.restore();
      done('Should not be here');
    })
    .catch((err) => {
      console.error('err: ', err);
      create.restore();
      o.sinon.assert.calledOnce(create);
      create = o.sinon.spy(provider.connection, 'createConfirmChannel');
      setTimeout(function() {
        create.restore();
        o.sinon.assert.calledOnce(create);
        done();
      }, provider.config.reChannelAfter);
    });
  });
});
