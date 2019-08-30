const puppeteer = require('puppeteer')

class Browser {
  constructor (option) {
    this.option = {
      ...option
    }
  }

  async start () {
    if (!this.browser) {
		
      this.browser = await puppeteer.launch(this.option)
      this.browser.once('disconnected', () => {
        this.browser = undefined
      })
      
      //login
      const page = await this.browser.newPage();
      await page.on('dialog', async dialog => {
       
       dialog.accept();
       
      });
      
      await page.goto('http://www.infoccsp.com/sso/sso-login.do');
  
      await page.type('#companyCode', 'HBWCKGAG');
      await page.type('#username', 'hbwckg005');
      await page.type('#password', 'hcbd8888');
      
      await page.click('#btnLogin');
    }

	
    return this.browser
  }
  
  async exit () {
    if (!this.browser) {
      return
    }
    await this.browser.close()
  }
  
  async open (url) {
    await this.start()
    const page = await this.browser.newPage()
    // 缓存状态下多页面可能不正常
    await page.setCacheEnabled(false)

    await page.goto(url, {
      waitUntil: 'networkidle0'
    })
    return page
  }
}

const browser = new Browser({
  headless: false
})

// 退出时结束浏览器，防止内存泄漏
process.on('exit', () => {
  browser.exit()
})

module.exports = browser