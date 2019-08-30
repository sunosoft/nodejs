let amqp = require('amqplib');

class RabbitMQ {
    constructor() {
		this.addUrl = 'amqp://ZXOSRMQ085:astiasti@mq.bondex.com.cn';
        this.open = amqp.connect(this.addUrl);
    }
    sendQueueMsg(queueName, msg, errCallBack) {
        let self = this;

        self.open
            .then(function (conn) {
                return conn.createChannel();
            })
            .then(function (channel) {
                return channel.assertQueue(queueName).then(function (ok) {
                    return channel.sendToQueue(queueName, Buffer.from(msg), {
                        persistent: true
                    });
                })
                    .then(function (data) {
                        if (data) {
                            errCallBack && errCallBack("success");
                            channel.close();
                        }
                    })
                    .catch(function () {
                        setTimeout(() => {
                            if (channel) {
                                channel.close();
                            }
                        }, 500)
                    });
            })
            .catch(function () {
            
                    self.open = amqp.connect(self.addUrl);

            });
    }
	
	receiveQueueMsg(queueName, receiveCallBack, errCallBack) {
        let self = this;

        self.open
            .then(function (conn) {
                conn.on('error', (err) => {
                    console.log('connect_error ' + err.message, err);
                    self.open = amqp.connect(self.addUrl);
                    self.receiveQueueMsg(queueName, receiveCallBack, errCallBack);
                })

                return conn.createChannel();
            })
            .then(function (channel) {
                return channel.assertQueue(queueName, {durable: false})
                    .then(function (ok) {
                        return channel.consume(queueName, function (msg) {
                            if (msg !== null) {
                                let data = msg.content.toString();
                                channel.ack(msg);
                                receiveCallBack && receiveCallBack(data);
                            }
                        });
                    })
            })
            .catch(function (err) {
                console.log('config_connect_error ' + err.message, err);
                self.open = amqp.connect(self.addUrl);
                self.receiveQueueMsg(queueName, receiveCallBack, errCallBack);
            });
	}
}

const rabbitMQ = new RabbitMQ()

module.exports = rabbitMQ