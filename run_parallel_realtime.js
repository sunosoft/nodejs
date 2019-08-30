const browser = require('./browser');

const rabbitmq = require('./rabbitmq');

//自定义日期格式化函数
Date.prototype.Format = function(fmt) { 
    var o = {
        "M+": this.getMonth() + 1, //月份 
        "d+": this.getDate(), //日 
        "h+": this.getHours(), //小时 
        "m+": this.getMinutes(), //分 
        "s+": this.getSeconds(), //秒 
        "S": this.getMilliseconds() //毫秒 
    };
    if (/(y+)/.test(fmt)) fmt = fmt.replace(RegExp.$1, (this.getFullYear() + "").substr(4 - RegExp.$1.length));
    for (var k in o)
        if (new RegExp("(" + k + ")").test(fmt)) fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
    return fmt;
}

//init browser
browser.start();

rabbitmq.receiveQueueMsg('MftCcspListenQueue',(msg) => {    
  run(msg);
})

//进入页面
async function run(jsMessage) {
	  
	  try {
			  
		  var mesEntity = JSON.parse(jsMessage);
	  
		  console.log(jsMessage);

		  if (mesEntity.billType == '0') {
			  
			  await run_main(mesEntity);
			  
		  } else if (mesEntity.billType == '1') {
			  
			  await run_sub(mesEntity);
			  
		  } else if (mesEntity.billType == '2') { //查询已申报数据状态

			  //主单查询
			  await run_query(false);
			  
			  //分单查询
			  await run_query(true);

		  } else {
			console.log('error billType : ' + mesEntity.billType);
		  }
			  
		  
		  
	  } catch(error) {
		  
		  console.log(error.name + ' '+ error.message);

	  }

//  await browser.close();
  
//  process.exit(0);
  
}

async function reLogin() {

	//login
	var page = await browser.open('http://www.infoccsp.com/sso/sso-login.do');

	await page.on('dialog', async dialog => {
	
	    dialog.accept();
	
	});

	await page.type('#companyCode', 'HBWCKGAG');
	await page.type('#username', 'hbwckg005');
	await page.type('#password', 'hcbd8888');
	
	await page.click('#btnLogin');

	await page.close();

}

async function run_query(isQuerySub) {
  
	var url = 'http://www.infoccsp.com/fas/declaration/MAWBDeclarationQueryAction.do';

	if(isQuerySub) {
		url = 'http://www.infoccsp.com/fas/declaration/HAWBDeclarationQueryAction.do';
	}

	var page = await browser.open(url);

	var companyCodeInput = await page.$('#companyCode');
	var usernameInput = await page.$('#username');
	var passwordInput = await page.$('#password');

	if(companyCodeInput && usernameInput && passwordInput) {
		
		await page.close();

		await reLogin();

		page = await browser.open(url);
	}

	if(!isQuerySub) {

		await page.$eval('#createBeginDate',input => input.value = '');
		await page.type("#createBeginDate", new Date(Date.now() - 1000*60*60*24*15).Format("yyyy-MM-dd"));
		
		await page.$eval('#createEndDate',input => input.value = '');
		await page.type("#createEndDate", (new Date()).Format("yyyy-MM-dd"));

	} else {

		await page.$eval('#startCreateDate',input => input.value = '');
		await page.type("#startCreateDate", new Date(Date.now() - 1000*60*60*24*15).Format("yyyy-MM-dd"));
		
		await page.$eval('#endCreateDate',input => input.value = '');
		await page.type("#endCreateDate", (new Date()).Format("yyyy-MM-dd"));
	}


	await page.click("#query");

	await page.waitFor("#tableItem");

	//start page data
	var num = 3;

    while(true) {

		var modelArray = await page.evaluate((date, isHouse) => {
	
			let list = document.querySelectorAll('#tableItem tbody tr');
			if (!list) {
				return;
			}

			var main = {};
			let backList = [];
	
			for (var i = 0; i < list.length; i++) {
				var row = list[i];
				var cells = row.cells;
	
				var no = cells[0].textContent;
				
				var houseNo = '';
				var status= '';
				var msg= '';

				if (isHouse) {
					houseNo = cells[1].textContent;
					status = cells[9].textContent;
					msg = cells[11].textContent;
				} else {
					status = cells[8].textContent;
					msg = cells[10].textContent;
				}


				//1-暂存成功  2-申报成功  3-申报取消  11-暂存失败 12-申报失败 999-未知消息
				var statusCode = 12;

				if(status == '已申报') {
					statusCode = 2;
				} else if (status == '已更新') {
					statusCode = 2;
					msg = msg + status;
				} else if (status == '申报取消') {
					statusCode = 3;
				}
		
				var msgModel = {
					'MasterBillNumber' : no,
					'SeparateBillNumber' : houseNo,
					'RequestTime' : date,
					'Status' : statusCode,
					'Receipt' : msg
				}
				backList.push(msgModel);              
			}

			main.BackList = backList;

			return main;      
	
		}, new Date().Format("yyyy-MM-dd"), isQuerySub);
	
		
	//	await page.evaluate(async() => $("a:contains('4')")[0].click());
	
		var lastPage = await page.evaluate(num => {
			var as = document.querySelectorAll('.pagination ul li');
	
			as[num].querySelector('a').click();

            if (as[num+1].querySelector('a').textContent == '>>') {
                return true;
			} else {
				return false;
			}
	
		}, num);
	
		await page.waitFor("#tableItem");

		let resultMsg = {};

		resultMsg.Head = await formatHead('AIR_CCSP_DECLARE_CALLBACK', 'CCSP外接系统申报回执');

		resultMsg.Main = modelArray;
		
		console.log(JSON.stringify(resultMsg));
		  
		await rabbitmq.sendQueueMsg('MftCcspListenQueue_callbackresult', JSON.stringify(resultMsg), 
		  (error) => {
			 console.log(error)
		});

		//next page num
		num++;

		if(lastPage) {
            break;
		}
	}

	await page.close()

}


async function run_main(mesEntity) {
  
	  var url = 'http://www.infoccsp.com/fas/declaration/MAWBDeclarationAction_init.do?mawb.awbPre=' + mesEntity.masterNo.substring(0,3) + '&mawb.awbNo=' + mesEntity.masterNo.substring(3) + '&mawb.declarationCustomsCode=8003';
	  
	  var page = await browser.open(url);

	  var companyCodeInput = await page.$('#companyCode');
	  var usernameInput = await page.$('#username');
	  var passwordInput = await page.$('#password');
  
	  if(companyCodeInput && usernameInput && passwordInput) {
		  
          await page.close();

		  await reLogin();
  
		  page = await browser.open(url);
	  }
	  
	  //海关货物类型 --- 固定值(普货)
	  var customsCargoType = 'GENERALCARGO';
	  
	  //始发站
	  var originAirport = mesEntity.loadPortCode;
	  
	  //到达站1
	  var arrivalAirport1 = mesEntity.destinationPortCode;
	  
	  //承运人1
	  var carrierId1 = mesEntity.carrier;
	  
	  //到达站2
	  var arrivalAirport2 = mesEntity.arrivalAirport2;
	  
	  //承运人2
	  var carrierId2 = mesEntity.carrier2;
	  
	  //到达站3
	  var arrivalAirport3 = '';
	  
	  //承运人3
	  var carrierId3 = '';
	  
	  //申报航班号
	  var initialFlightNo = mesEntity.voyage;
	  
	  //航班日期
	  var initialFlightDate = mesEntity.voyageDate;
	  
	  //发货人名称
	  var shipShortName = mesEntity.shipper;
	  
	  //发货人地址
	  var shipAddress = mesEntity.shipperAddress;
	  
	  //发货人邮编
	  var shipZipCode = mesEntity.shipperZipCode;
	  
	  //发货人城市
	  var shipCity = mesEntity.shipperCity;
	  
	  //发货人州
	  var shipState = mesEntity.shipperState;
	  
	  //发货人国家或地区
	  var shipCountry = mesEntity.shipperCountry.substring(mesEntity.shipperCountry.indexOf('[') + 1, mesEntity.shipperCountry.indexOf(']'));
	  
	  //发货人电话
	  var shipTel = mesEntity.shipperPhone;
	  
	  //发货人传真
	  var shipFax = mesEntity.shipperFax;
	  
	  //发货人联系人
	  var shipContractor = '';
	  
	  //发货人企业代码类型
	  var shipCustomsIdentifier = mesEntity.shipperCode.split('+')[0];
	  
	  //发货人企业代码
	  var shipCustomsCode = mesEntity.shipperCode.split('+')[1];
	  
	  //发货人AEO代码
	  var shipAEOCode = mesEntity.shipperAEO;
	  
	  //收货人名称
	  var consShortName = mesEntity.cnee;
	  
	  //收货人地址
	  var consAddress = mesEntity.cneeAddress;
	  
	  //收货人邮编
	  var consZipCode = mesEntity.consigneeZipCode;
	  
	  //收货人城市---默认值
	  var consCity = mesEntity.consigneeCity;
	  
	  //收货人州
	  var consState = mesEntity.consigneeState;
	  
	  //收货人国家或地区
	  var consCountry = mesEntity.cneeCountry.substring(mesEntity.cneeCountry.indexOf('[') + 1, mesEntity.cneeCountry.indexOf(']'));
	  
	  //收货人电话
	  var consTel = mesEntity.cneePhone;
	  
	  //收货人传真
	  var consFax = mesEntity.cneeFax;
	  
	  //收货人联系人
	  var consContractor = '';
	  
	  //收货人企业代码类型
	  var consCustomsIdentifier = mesEntity.cneeCode.split('+')[0];
	  
	  //收货人企业代码
	  var consCustomsCode = mesEntity.cneeCode.split('+')[1];
	  
	  //收货人AEO代码
	  var consAEOCode = mesEntity.cneeAEO;
	  
	  //件数
	  var pcs = mesEntity.picsSum;
	  
	  //毛重
	  var grossWt = mesEntity.weightSum;
	  
	  //支付方式
	  var valuePaymode = mesEntity.payMethod.substring(mesEntity.payMethod.indexOf('[') + 1, mesEntity.payMethod.indexOf(']'));
	  
	  //货物品名
	  var cargoName = mesEntity.cargos[0].description;
	  
	  //特货代码
	  var spechandingcode = mesEntity.specialHandingCode;
	  
	  
	  //发货人信息填充 --- 取消
	//   await page.click('#shipSelect');
	//   await searchShipperAndConee(page, shipShortName);
	  
	  //收货人信息填充 --- 取消
	//   await page.click('#consSelect');
    //   await searchShipperAndConee(page, consShortName);
	  
	  //根据初始值设置 
	  
	  //999单号---国货航重庆货站
	  //非999单号---重庆机场货站
	  if (mesEntity.masterNo.substring(0,3) == '999') {
		  await page.select('#operationAircargoTerminal', 'CKGZH');
	  } else {
		  await page.select('#operationAircargoTerminal', 'CKGXH');
	  }
	  
	  if (customsCargoType != null && customsCargoType != '') {
		  await page.select('#customsCargoType', customsCargoType);
	  }
	  
	  if (originAirport != null && originAirport != '') {
		  await page.$eval('#originAirport',input => input.value = '');
		  await page.type('#originAirport', originAirport);
	  }
	  
      if(arrivalAirport2 !=null && arrivalAirport2 !='' && carrierId2 !=null && carrierId2 !='') {

			if (arrivalAirport2 != null && arrivalAirport2 != '') {
				await page.$eval('#arrivalAirport1',input => input.value = '');
				await page.type('#arrivalAirport1', arrivalAirport2);
			}
			
			if (carrierId2 != null && carrierId2 != '') {
				await page.$eval('#carrierId1',input => input.value = '');
				await page.type('#carrierId1', carrierId2);
			}
			
			if (arrivalAirport1 != null && arrivalAirport1 != '') {
				await page.$eval('#arrivalAirport2',input => input.value = '');
				await page.type('#arrivalAirport2', arrivalAirport1);
			}
			
			if (carrierId1 != null && carrierId1 != '') {
				await page.$eval('#carrierId2',input => input.value = '');
				await page.type('#carrierId2', carrierId1);
			}

	  } else {
		  
			if (arrivalAirport1 != null && arrivalAirport1 != '') {
				await page.$eval('#arrivalAirport1',input => input.value = '');
				await page.type('#arrivalAirport1', arrivalAirport1);
			}
			
			if (carrierId1 != null && carrierId1 != '') {
				await page.$eval('#carrierId1',input => input.value = '');
				await page.type('#carrierId1', carrierId1);
			}
			
			if (arrivalAirport2 != null && arrivalAirport2 != '') {
				await page.$eval('#arrivalAirport2',input => input.value = '');
				await page.type('#arrivalAirport2', arrivalAirport2);
			}
			
			if (carrierId2 != null && carrierId2 != '') {
				await page.$eval('#carrierId2',input => input.value = '');
				await page.type('#carrierId2', carrierId2);
			}

	  }
	  


	  if (arrivalAirport3 != null && arrivalAirport3 != '') {
		  await page.$eval('#arrivalAirport3',input => input.value = '');
		  await page.type('#arrivalAirport3', arrivalAirport3);
	  }
	  
	  if (carrierId3 != null && carrierId3 != '') {
		  await page.$eval('#carrierId3',input => input.value = '');
		  await page.type('#carrierId3', carrierId3);
	  }
	  
	  if (initialFlightNo != null && initialFlightNo != '') {
		  await page.$eval('#initialFlightNo',input => input.value = '');
		  await page.type('#initialFlightNo', initialFlightNo);
	  }
	  
	  if (initialFlightDate != null && initialFlightDate != '') {
		  await page.$eval('#initialFlightDate',input => input.value = '');
		  await page.type('#initialFlightDate', initialFlightDate);
	  }
	  
	  
	  
	  if (shipShortName != null && shipShortName != '') {
		  await page.$eval('#shipShortName',input => input.value = '');
		  await page.type('#shipShortName', shipShortName);
	  }
	  
	  if (shipAddress != null && shipAddress != '') {
		  await page.$eval('#shipAddress',input => input.value = '');
		  await page.type('#shipAddress', shipAddress);
	  }
	  
	  if (shipCity != null && shipCity != '') {
		  await page.$eval('#shipCity',input => input.value = '');
		  await page.type('#shipCity', shipCity);
	  }
	//   var shipCityValue = await page.$eval('#shipCity', el => el.value);
	  
	//   if(shipCityValue == null || shipCityValue == '') {
	// 	  await page.type('#shipCity', shipCity);
	//   }
	  
	  if (shipCountry != null && shipCountry != '') {
		  await page.$eval('#shipCountry',input => input.value = '');
		  await page.type('#shipCountry', shipCountry);
	  }
	  
	  var shipCountryValue = await page.$eval('#shipCountry', el => el.value);
	  
	  if (shipState != null && shipState != '') {
		  await page.$eval('#shipState',input => input.value = '');
		  await page.type('#shipState', shipState);
	  } else {
		  
		  //US CA 必须设置 州 --- 默认值'HJ'
		  var shipStateValue = await page.$eval('#shipState', el => el.value);
		  
		  if ((shipCountryValue == 'US' || shipCountryValue == 'CA') && shipStateValue == '') {
			
		    await page.type('#shipState', 'HJ');
			  
		  }
		  
	  }
	  
	  if (shipZipCode != null && shipZipCode != '') {
		  await page.$eval('#shipZipCode',input => input.value = '');
		  await page.type('#shipZipCode', shipZipCode);
	  } else {
		  
		 //US DE 必须设置 邮政编码且必须为5位数字 --- 默认值'00000'
		 //CA 必须设置 邮政编码且必须为6位数字与字母组合 --- 默认值'A1B2C3'
		var shipZipCodeValue = await page.$eval('#shipZipCode', el => el.value);
		  
		if (shipZipCodeValue == '') {
			if (shipCountryValue == 'US' || shipCountryValue == 'DE') {

			  await page.$eval('#shipZipCode',input => input.value = '');
			  await page.type('#shipZipCode', '00000');

			} else if (shipCountryValue == 'CA') {
			  
			  await page.$eval('#shipZipCode',input => input.value = '');
			  await page.type('#shipZipCode', 'A1B2C3');

			}
		}

	  }
	  
	  if (shipTel != null && shipTel != '') {
		  await page.$eval('#shipTel',input => input.value = '');
		  await page.type('#shipTel', shipTel.replace(/\s+/g,""));
	  }
	  
	  if (shipFax != null && shipFax != '') {
		  await page.$eval('#shipFax',input => input.value = '');
		  await page.type('#shipFax', shipFax);
	  }
	  
	  if (shipContractor != null && shipContractor != '') {
		  await page.$eval('#shipContractor',input => input.value = '');
		  await page.type('#shipContractor', shipContractor);
	  }
	  
	  //先填写企业代码再选择类型
	  if (shipCustomsCode != null && shipCustomsCode != '') {
		  await page.$eval('#shipCustomsCode',input => input.value = '');
		  await page.type('#shipCustomsCode', shipCustomsCode);
	  }
	  
	  if (shipCustomsIdentifier != null && shipCustomsIdentifier != '') {
		  await page.select('#shipCustomsIdentifier', shipCustomsIdentifier);
		  
		  //未选中企业类型直接清空企业编码
		  var shipCustomsIdentifierValue = await page.$eval('#shipCustomsIdentifier', el => el.value);
	  
	      if(shipCustomsIdentifierValue == null || shipCustomsIdentifierValue == '') {
		      await page.$eval('#shipCustomsCode',input => input.value = '');
	      }
	  }
	  
	  if (shipAEOCode != null && shipAEOCode != '') {
		  await page.$eval('#shipAEOCode',input => input.value = '');
		  await page.type('#shipAEOCode', shipAEOCode);
	  }
	  
	  
	  if (consShortName != null && consShortName != '') {
		  await page.$eval('#consShortName',input => input.value = '');
		  await page.type('#consShortName', consShortName);
	  }
	  
	  if (consAddress != null && consAddress != '') {
		  await page.$eval('#consAddress',input => input.value = '');
		  await page.type('#consAddress', consAddress);
	  }
	  

	if (consCity != null && consCity != '') {
		await page.$eval('#consCity',input => input.value = '');
		await page.type('#consCity', consCity);
	}
	//   var consCityValue = await page.$eval('#consCity', el => el.value);
			
	//   if(consCityValue == null || consCityValue == '') {
	// 	  await page.type('#consCity', consCity);
	//   }
	  
	  if (consCountry != null && consCountry != '') {
		  await page.$eval('#consCountry',input => input.value = '');
		  await page.type('#consCountry', consCountry);
	  }
	  
	  var consCountryValue = await page.$eval('#consCountry', el => el.value);
	  
	  if (consState != null && consState != '') {
		  await page.$eval('#consState',input => input.value = '');
		  await page.type('#consState', consState);
	  } else {
		  
		  //US CA 必须设置 州 --- 默认值'HJ'
		  var consStateValue = await page.$eval('#consState', el => el.value);
		  
		  if ((consCountryValue == 'US' || consCountryValue == 'CA') && consStateValue == '') {
			  
			await page.$eval('#consState',input => input.value = '');
		    await page.type('#consState', 'HJ');
			  
		  }
		  
	  }
	  
	  if (consZipCode != null && consZipCode != '') {
		  await page.$eval('#consZipCode',input => input.value = '');
		  await page.type('#consZipCode', consZipCode);
	  } else {
		  
		//US DE 必须设置 邮政编码且必须为5位数字 --- 默认值'00000'
		//CA 必须设置 邮政编码且必须为6位数字与字母组合 --- 默认值'A1B2C3'
		var consZipCodeValue = await page.$eval('#consZipCode', el => el.value);
		
		if (consZipCodeValue == '') {
			if (consCountryValue == 'US' || consCountryValue == 'DE') {

			  await page.$eval('#consZipCode',input => input.value = '');
			  await page.type('#consZipCode', '00000');

			} else if (consCountryValue == 'CA') {
			  
			  await page.$eval('#consZipCode',input => input.value = '');
			  await page.type('#consZipCode', 'A1B2C3');

			}
		}

	  }
	  
	  if (consTel != null && consTel != '') {
		  await page.$eval('#consTel',input => input.value = '');
		  await page.type('#consTel', consTel.replace(/\s+/g,""));
	  }
	  
	  if (consFax != null && consFax != '') {
		  await page.$eval('#consFax',input => input.value = '');
		  await page.type('#consFax', consFax);
	  }
	  
	  if (consContractor != null && consContractor != '') {
		  await page.$eval('#consContractor',input => input.value = '');
		  await page.type('#consContractor', consContractor);
	  }
	  
	  //先填写企业代码再选择类型
	  if (consCustomsCode != null && consCustomsCode != '') {
		  await page.$eval('#consCustomsCode',input => input.value = '');
		  await page.type('#consCustomsCode', consCustomsCode);
	  }
	  
	  if (consCustomsIdentifier != null && consCustomsIdentifier != '') {
		  await page.select('#consCustomsIdentifier', consCustomsIdentifier);
		  
		  //未选中企业类型直接清空企业编码
		  var consCustomsIdentifierValue = await page.$eval('#consCustomsIdentifier', el => el.value);
	  
	      if(consCustomsIdentifierValue == null || consCustomsIdentifierValue == '') {
		      await page.$eval('#consCustomsCode',input => input.value = '');
	      }
	  }
	  
	  if (consAEOCode != null && consAEOCode != '') {
		  await page.$eval('#consAEOCode',input => input.value = '');
		  await page.type('#consAEOCode', consAEOCode);
	  }
	  
	  //数字型特殊处理
	  if (pcs != null && pcs != '') {
		  await page.$eval('#pcs',input => input.value = '');
		  await page.type('#pcs', String(parseInt(pcs)));
	  }
	  
	  //数字型特殊处理
	  if (grossWt != null && grossWt != '') {
		  await page.$eval('#grossWt',input => input.value = '');
		  await page.type('#grossWt', String(parseInt(grossWt)));
	  }
	  
	  if (valuePaymode != null && valuePaymode != '') {
		  await page.select('#valuePaymode', valuePaymode);
	  }
	  
	  if (cargoName != null && cargoName != '') {
		  await page.$eval('#cargoName',input => input.value = '');
		  await page.type('#cargoName', cargoName);
	  }
	  
	  if (spechandingcode != null && spechandingcode != '') {
		  await page.$eval('#spechandingcode',input => input.value = '');
		  await page.type('#spechandingcode', spechandingcode);
	  }
	  
	  var btnSaveEntry = await page.$('#btnSaveEntry');
      
      if(btnSaveEntry) {

		  await page.click('#btnSaveEntry');
		  
		  await page.waitFor('.aui_state_highlight');
	
		  var message = await page.$eval('.aui_content', el => el.innerHTML);
	
		  let resultMsg = {};
	
		  if (message.includes('是否继续')) {
	
			await page.click('.aui_state_highlight');
			await page.waitFor('.aui_state_highlight');
	
			message = await page.$eval('.aui_content', el => el.innerHTML);
	
		  }
	
		  resultMsg.Head = await formatHead('AIR_CCSP_SAVE_CALLBACK', 'CCSP外接系统暂存回执');
		  
		  var code;
		  if (message.includes('保存成功')) {
			code = 1;
		  } else {
			code = 11;
		  }

		  resultMsg.Main = await formatMain(mesEntity.masterNo, mesEntity.houseNo, code, message);
		  
		  console.log(JSON.stringify(resultMsg));
	
		  await rabbitmq.sendQueueMsg('MftCcspListenQueue_callbackresult', JSON.stringify(resultMsg), 
		  (error) => {
			 console.log(error)
		  })
	  }

	  await page.close();
	
}

async function run_sub(mesEntity) {
	
	  var subNO = mesEntity.houseNo;
	  
	  var url = 'http://www.infoccsp.com/fas/declaration/HAWBDeclarationAction_init.do?hawb.awbPre=' + mesEntity.masterNo.substring(0,3) + '&hawb.awbNo=' + mesEntity.masterNo.substring(3) + '&hawb.hawbNo=' + subNO + '&hawb.declarationCustomsCode=8003';
	  
	  var page = await browser.open(url);
	//  await page.goto('http://www.infoccsp.com/fas/declaration/MAWBDeclarationAction_init.do?mawb.awbPre=999&mawb.awbNo=70293650&mawb.declarationCustomsCode=8003');
		  
	  var companyCodeInput = await page.$('#companyCode');
	  var usernameInput = await page.$('#username');
	  var passwordInput = await page.$('#password');

	  if(companyCodeInput && usernameInput && passwordInput) {
			
		  await page.close();

		  await reLogin();

		  page = await browser.open(url);
	  }


	  //海关货物类型
	  var customsCargoType = 'GENERALCARGO';
	  
	  //始发站
	  var originAirport = mesEntity.loadPortCode;
	  
	  //目的站
	  var destAirport = mesEntity.destinationPortCode;
	  
	  //申报航班号
	  var flightNo = mesEntity.voyage;
	  
	  //航班日期
	  var flightDate = mesEntity.voyageDate;
	  
	  //发货人名称
	  var shipShortName = mesEntity.shipper;
	  
	  //发货人地址
	  var shipAddress = mesEntity.shipperAddress;
	  
	  //发货人邮编
	  var shipZipCode = mesEntity.shipperZipCode;
	  
	  //发货人城市
	  var shipCity = mesEntity.shipperCity;
	  
	  //发货人州
	  var shipState = mesEntity.shipperState;
	  
	  //发货人国家或地区
	  var shipCountry = mesEntity.shipperCountry.substring(mesEntity.shipperCountry.indexOf('[') + 1, mesEntity.shipperCountry.indexOf(']'));
	  
	  //发货人电话
	  var shipTel = mesEntity.shipperPhone;
	  
	  //发货人传真
	  var shipFax = mesEntity.shipperFax;
	  
	  //发货人企业代码类型
	  var shipCustomsIdentifier = mesEntity.shipperCode.split('+')[0];
	  
	  //发货人企业代码
	  var shipCustomsCode = mesEntity.shipperCode.split('+')[1];
	  
	  //发货人AEO代码
	  var shipAEOCode = mesEntity.shipperAEO;
	  
	  //收货人名称
	  var consShortName = mesEntity.cnee;
	  
	  //收货人地址
	  var consAddress = mesEntity.cneeAddress;
	  
	  //收货人邮编
	  var consZipCode = mesEntity.consigneeZipCode;
	  
	  //收货人城市
	  var consCity = mesEntity.consigneeCity;
	  
	  //收货人州
	  var consState = mesEntity.consigneeState;
	  
	  //收货人国家或地区
	  var consCountry = mesEntity.cneeCountry.substring(mesEntity.cneeCountry.indexOf('[') + 1, mesEntity.cneeCountry.indexOf(']'));
	  
	  //收货人电话
	  var consTel = mesEntity.cneePhone;
	  
	  //收货人传真
	  var consFax = mesEntity.cneeFax;
	  
	  //收货人企业代码类型
	  var consCustomsIdentifier = mesEntity.cneeCode.split('+')[0];
	  
	  //收货人企业代码
	  var consCustomsCode = mesEntity.cneeCode.split('+')[1];
	  
	  //收货人AEO代码
	  var consAEOCode = mesEntity.cneeAEO;
	  
	  //件数
	  var pcs = mesEntity.picsSum;
	  
	  //毛重
	  var grossWt = mesEntity.weightSum;
	  
	  //支付方式
	  var valuePaymode = mesEntity.payMethod.substring(mesEntity.payMethod.indexOf('[') + 1, mesEntity.payMethod.indexOf(']'));
	  
	  //货物品名
	  var cargoName = mesEntity.cargos[0].description;
	  
	  //特货代码
	  var spechandingcode = mesEntity.specialHandingCode;
	  
	  
	  //发货人信息填充 --- 取消
	//   await page.click('#shipSelect');
	//   await searchShipperAndConee(page, shipShortName);
	  
	  //收货人信息填充 --- 取消
	//   await page.click('#consSelect');
	//   await searchShipperAndConee(page, consShortName);
	  
	  
	  //根据初始值设置
	  
	  if (customsCargoType != null && customsCargoType != '') {
		  await page.select('#customsCargoType', customsCargoType);
	  }
	  
	  if (originAirport != null && originAirport != '') {
		  await page.$eval('#originAirport',input => input.value = '');
		  await page.type('#originAirport', originAirport);
	  }
	  
	  if (destAirport != null && destAirport != '') {
		  await page.$eval('#destAirport',input => input.value = '');
		  await page.type('#destAirport', destAirport);
	  }
	  
	  if (flightNo != null && flightNo != '') {
		  await page.$eval('#flightNo',input => input.value = '');
		  await page.type('#flightNo', flightNo);
	  }
	  
	  if (flightDate != null && flightDate != '') {
		  await page.$eval('#flightDate',input => input.value = '');
		  await page.type('#flightDate', flightDate);
	  }
	  
	  if (shipShortName != null && shipShortName != '') {
		  await page.$eval('#shipShortName',input => input.value = '');
		  await page.type('#shipShortName', shipShortName);
	  }
	  
	  if (shipAddress != null && shipAddress != '') {
		  await page.$eval('#shipAddress',input => input.value = '');
		  await page.type('#shipAddress', shipAddress);
	  }
	  
	  if (shipCity != null && shipCity != '') {
		  await page.$eval('#shipCity',input => input.value = '');
		  await page.type('#shipCity', shipCity);
	  }
	//   var shipCityValue = await page.$eval('#shipCity', el => el.value);
	  
	//   if(shipCityValue == null || shipCityValue == '') {
	// 	  await page.type('#shipCity', shipCity);
	//   }
	  
	  if (shipState != null && shipState != '') {
		  await page.$eval('#shipState',input => input.value = '');
		  await page.type('#shipState', shipState);
	  }
	  
	  if (shipCountry != null && shipCountry != '') {
		  await page.$eval('#shipCountry',input => input.value = '');
		  await page.type('#shipCountry', shipCountry);
	  }
	  
	  var shipCountryValue = await page.$eval('#shipCountry', el => el.value);
	  
	  if (shipState != null && shipState != '') {
		  await page.$eval('#shipState',input => input.value = '');
		  await page.type('#shipState', shipState);
	  } else {
		  
		  //US CA 必须设置 州 --- 默认值'HJ'
		  var shipStateValue = await page.$eval('#shipState', el => el.value);
		  
		  if ((shipCountryValue == 'US' || shipCountryValue == 'CA') && shipStateValue == '') {
			  
			await page.$eval('#shipState',input => input.value = '');
		    await page.type('#shipState', 'HJ');
			  
		  }
		  
	  }
	  
	  if (shipZipCode != null && shipZipCode != '') {
		  await page.$eval('#shipZipCode',input => input.value = '');
		  await page.type('#shipZipCode', shipZipCode);
	  } else {
		  
		var shipZipCodeValue = await page.$eval('#shipZipCode', el => el.value);
		  
		//US DE 必须设置 邮政编码且必须为5位数字 --- 默认值'00000'
		//CA 必须设置 邮政编码且必须为6位数字与字母组合 --- 默认值'A1B2C3'
		if (shipZipCodeValue == '') {
			if (shipCountryValue == 'US' || shipCountryValue == 'DE') {

			  await page.$eval('#shipZipCode',input => input.value = '');
			  await page.type('#shipZipCode', '00000');

			} else if (shipCountryValue == 'CA') {
			  
			  await page.$eval('#shipZipCode',input => input.value = '');
			  await page.type('#shipZipCode', 'A1B2C3');

			}
		}

	  }
	  
	  if (shipTel != null && shipTel != '') {
		  await page.$eval('#shipTel',input => input.value = '');
		  await page.type('#shipTel', shipTel.replace(/\s+/g,""));
	  }
	  
	  if (shipFax != null && shipFax != '') {
		  await page.$eval('#shipFax',input => input.value = '');
		  await page.type('#shipFax', shipFax);
	  }
	  
	  //先填写企业代码再选择类型
	  if (shipCustomsCode != null && shipCustomsCode != '') {
		  await page.$eval('#shipCustomsCode',input => input.value = '');
		  await page.type('#shipCustomsCode', shipCustomsCode);
	  }
	  
	  if (shipCustomsIdentifier != null && shipCustomsIdentifier != '') {
		  await page.select('#shipCustomsIdentifier', shipCustomsIdentifier);
		  
		  //未选中企业类型直接清空企业编码
		  var shipCustomsIdentifierValue = await page.$eval('#shipCustomsIdentifier', el => el.value);
	  
	      if(shipCustomsIdentifierValue == null || shipCustomsIdentifierValue == '') {
		      await page.$eval('#shipCustomsCode',input => input.value = '');
	      }
	  }
	  
	  if (shipAEOCode != null && shipAEOCode != '') {
		  await page.$eval('#shipAEOCode',input => input.value = '');
		  await page.type('#shipAEOCode', shipAEOCode);
	  }
	  
	  
	  
	  if (consShortName != null && consShortName != '') {
		  await page.$eval('#consShortName',input => input.value = '');
		  await page.type('#consShortName', consShortName);
	  }
	  
	  if (consAddress != null && consAddress != '') {
		  await page.$eval('#consAddress',input => input.value = '');
		  await page.type('#consAddress', consAddress);
	  }
	  
	  //city 特殊处理
	  //	  if (consCity != null && consCity != '') {
	  //		  await page.$eval('#consCity',input => input.value = '');
	  //		  await page.type('#consCity', consCity);
	  //	  }
	  var consCityValue = await page.$eval('#consCity', el => el.value);
			
	  if(consCityValue == null || consCityValue == '') {
		  await page.type('#consCity', consCity);
	  }
	  
	  
	  if (consState != null && consState != '') {
		  await page.$eval('#consState',input => input.value = '');
		  await page.type('#consState', consState);
	  }
	  
	  if (consCountry != null && consCountry != '') {
		  await page.$eval('#consCountry',input => input.value = '');
		  await page.type('#consCountry', consCountry);
	  }
	  
	  var consCountryValue = await page.$eval('#consCountry', el => el.value);
	  
	  if (consState != null && consState != '') {
		  await page.$eval('#consState',input => input.value = '');
		  await page.type('#consState', consState);
	  } else {
		  
		  //US CA 必须设置 州 --- 默认值'HJ'
		  var consStateValue = await page.$eval('#consState', el => el.value);
		  
		  if ((consCountryValue == 'US' || consCountryValue == 'CA') && consStateValue == '') {
			  
			await page.$eval('#consState',input => input.value = '');
		    await page.type('#consState', 'HJ');
			  
		  }
		  
	  }
	  
	  if (consZipCode != null && consZipCode != '') {
		  await page.$eval('#consZipCode',input => input.value = '');
		  await page.type('#consZipCode', consZipCode);
	  } else {
		  
		//US DE 必须设置 邮政编码且必须为5位数字 --- 默认值'00000'
		//CA 必须设置 邮政编码且必须为6位数字与字母组合 --- 默认值'A1B2C3'
		var consZipCodeValue = await page.$eval('#consZipCode', el => el.value);
		
		if (consZipCodeValue == '') {
			if (consCountryValue == 'US' || consCountryValue == 'DE') {

			  await page.$eval('#consZipCode',input => input.value = '');
			  await page.type('#consZipCode', '00000');

			} else if (consCountryValue == 'CA') {
			  
			  await page.$eval('#consZipCode',input => input.value = '');
			  await page.type('#consZipCode', 'A1B2C3');

			}
		}

	  }
	  
	  if (consTel != null && consTel != '') {
		  await page.$eval('#consTel',input => input.value = '');
		  await page.type('#consTel', consTel.replace(/\s+/g,""));
	  }
	  
	  if (consFax != null && consFax != '') {
		  await page.$eval('#consFax',input => input.value = '');
		  await page.type('#consFax', consFax);
	  }
	  
	  //先填写企业代码再选择类型
	  if (consCustomsCode != null && consCustomsCode != '') {
		  await page.$eval('#consCustomsCode',input => input.value = '');
		  await page.type('#consCustomsCode', consCustomsCode);
	  }
	  
	  if (consCustomsIdentifier != null && consCustomsIdentifier != '') {
		  await page.select('#consCustomsIdentifier', consCustomsIdentifier);
		  
		  //未选中企业类型直接清空企业编码
		  var consCustomsIdentifierValue = await page.$eval('#consCustomsIdentifier', el => el.value);
	  
	      if(consCustomsIdentifierValue == null || consCustomsIdentifierValue == '') {
		      await page.$eval('#consCustomsCode',input => input.value = '');
	      }
	  }
	  
	  if (consAEOCode != null && consAEOCode != '') {
		  await page.$eval('#consAEOCode',input => input.value = '');
		  await page.type('#consAEOCode', consAEOCode);
	  }
	  
	  //数字型特殊处理
	  if (pcs != null && pcs != '') {
		  await page.$eval('#pcs',input => input.value = '');
		  await page.type('#pcs', String(parseInt(pcs)));
	  }
	  
	  //数字型特殊处理
	  if (grossWt != null && grossWt != '') {
		  await page.$eval('#grossWt',input => input.value = '');
		  await page.type('#grossWt', String(parseInt(grossWt)));
	  }
	  
	  if (valuePaymode != null && valuePaymode != '') {
		  await page.select('#valuePaymode', valuePaymode);
	  }
	  
	  if (cargoName != null && cargoName != '') {
		  await page.$eval('#cargoName',input => input.value = '');
		  await page.type('#cargoName', cargoName);
	  }
	  
	  if (spechandingcode != null && spechandingcode != '') {
		  await page.$eval('#spechandingcode',input => input.value = '');
		  await page.type('#spechandingcode', spechandingcode);
	  }
	  
	//  await page.screenshot({
	//        path: 'test.png'
	//  })

	  var btnSaveEntry = await page.$('#btnSaveEntry');
      
      if(btnSaveEntry) {

		  await page.click('#btnSaveEntry');

		  await page.waitFor('.aui_state_highlight');
		  
		  var message = await page.$eval('.aui_content', el => el.innerHTML);
		  
		  console.log(message);
	
		  let resultMsg = {};

		  if (message.includes('是否继续')) {
	
			await page.click('.aui_state_highlight');
			await page.waitFor('.aui_state_highlight');
	
			message = await page.$eval('.aui_content', el => el.innerHTML);
	
		  }
	
		  resultMsg.Head = await formatHead('AIR_CCSP_SAVE_CALLBACK', 'CCSP外接系统暂存回执');
		  
		  var code;
		  if (message.includes('保存成功')) {
			code = 1;
		  } else {
			code = 11;
		  }

		  resultMsg.Main = await formatMain(mesEntity.masterNo, mesEntity.houseNo, code, message);
		  
		  console.log(JSON.stringify(resultMsg));
		  
		  await rabbitmq.sendQueueMsg('MftCcspListenQueue_callbackresult', JSON.stringify(resultMsg), 
		  (error) => {
			 console.log(error)
		  })
	  }
	  

	  await page.close();
//	  await page.click('.aui_state_highlight');
	
}

async function formatHead(docTypeID, docName) {

	var head = {};

	head.SeqNo = 'e6be15fe-b9af-46fe-a3aa-c7b28769dda8';
	head.SenderID = 'CCSPExternalPlat';
	head.SenderName = 'CCSP外接系统';
	head.ReciverID = 'ManifestPlat';
	head.ReciverName = '舱单平台';
	head.DocTypeID = docTypeID;
	head.DocName = docName;
	head.CreateTime = (new Date()).Format("yyyy-MM-dd");
	head.FinishTime = null;
	head.DataInterfaceID = null;
	head.DataInterfaceName = null;
	head.Version = '1.0';
	head.TZ = 0;
	head.Token = null;
	head.ListenExchangeName = '';
	head.RoutingKeyName = null;
	head.CallBackType = 'Asynchronization';
	head.ClientIpAddress = null;

	return head;
} 

//status : 1-暂存成功  2-申报成功  3-申报取消  11-暂存失败 12-申报失败 999-未知消息
async function formatMain(no, housrNo, status, msg) {

	var main = {};
	
	var backList = [];

	var backMsg = {};
	
	backMsg.MasterBillNumber = no;
	backMsg.SeparateBillNumber = housrNo;
	backMsg.Status = status;
	backMsg.RequestTime = (new Date()).Format("yyyy-MM-dd");
	backMsg.Receipt = msg;

	backList.push(backMsg);

	main.BackList = backList;

    return main;
}

//run();

async function searchShipperAndConee(page, shortName) {
	await page.waitFor('#shortname');
	await page.type('#shortname', shortName);
	await page.click('#btnQuery');
	await page.waitFor('.action-link', { timeout: 500 }).catch(() => page.click('.aui_close'));
	const consReslt = await page.evaluate(param => {
		if (document.querySelectorAll('.action-link').length > 0) {
			if (Array.from(document.querySelectorAll('.action-link')).filter(element => element.text.trim() == param.trim()).length > 0) {
				Array.from(document.querySelectorAll('.action-link')).filter(element => element.text.trim() == param.trim())[0].click();
				return 1;
			}
			else {
				return 0;
			}
		}
		else {
			return 1;
		}
	}, shortName);
	// console.log(consReslt);
	if (consReslt == 0) {
		await page.click('.aui_close');
	}
	await page.waitFor(5000);
}
