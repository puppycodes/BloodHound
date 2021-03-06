import React, { Component } from 'react';
import MenuButton from './MenuButton';
import ProgressBarMenuButton from './ProgressBarMenuButton';
import { buildDomainProps, buildSessionProps, buildLocalAdminProps, buildGroupMembershipProps } from 'utils';
import { If, Then, Else } from 'react-if';
const { dialog, clipboard } = require('electron').remote
var fs = require('fs')

export default class MenuContainer extends Component {
	constructor(){
		super()

		this.state = {
			refreshHover: false,
			uploading: false,
			progress: 0,
			parser: null
		}

		emitter.on('cancelUpload', this.cancelUpload.bind(this))
	}

	cancelUpload(){
		this.state.parser.abort()
		setTimeout(function(){
			this.setState({uploading: false})
		}.bind(this), 1000)
	}

	_refreshClick(){
		emitter.emit('graphRefresh')
	}

	_changeLayoutClick(){
		appStore.dagre = !appStore.dagre
		emitter.emit('graphRefresh')
		var type = appStore.dagre ? 'Hierarchical' : 'Directed'
		emitter.emit('showAlert', 'Changed Layout to ' + type)
	}

	_exportClick(){
		emitter.emit('showExport');
	}

	_importClick(){
		var fname = dialog.showOpenDialog({
			properties: ['openFile']
		})
		if (typeof fname !== 'undefined'){
			emitter.emit('import',fname[0])
		}
	}

	_uploadClick(){
		var filename = dialog.showOpenDialog({
			properties: ['openFile']
		})[0]
		var sent = 0
		fs.readFile(filename, 'utf8', function(err, data){
			var count = data.split('\n').length;
			var header = data.split('\n')[0]
			var filetype;
			if (header.includes('UserName') && header.includes('ComputerName') && header.includes('Weight')){
				filetype = 'sessions'
			}else if (header.includes('AccountName') && header.includes('AccountType') && header.includes('GroupName')){
				filetype = 'groupmembership'
			}else if (header.includes('AccountName') && header.includes('AccountType') && header.includes('ComputerName')){
				filetype = 'localadmin'
			}else if (header.includes('SourceDomain') && header.includes('TargetDomain') && header.includes('TrustDirection') && header.includes('TrustType') && header.includes('Transitive')){
				filetype = 'domain'
			}

			if (typeof filetype === 'undefined'){
				emitter.emit('showAlert', 'Unrecognized CSV Type');
				return;
			}

			this.setState({
				uploading: true,
				progress: 0
			})

			Papa.parse(data,{
				header: true,
				dynamicTyping: true,
				chunkSize: 50000,
				skipEmptyLines: true,
				chunk: function(rows, parser){
					this.setState({parser: parser})
					if (rows.data.length === 0){
						parser.abort()
						this.setState({progress:100})
						setTimeout(function(){
							this.setState({uploading: false})
						}.bind(this), 3000)
						emitter.emit('refreshDBData')
						return
					}
					parser.pause()
					sent += rows.data.length
					if (filetype === 'sessions'){
						var query = 'UNWIND {props} AS prop MERGE (user:User {name:prop.account}) WITH user,prop MERGE (computer:Computer {name: prop.computer}) WITH user,computer,prop MERGE (computer)-[:HasSession {Weight : prop.weight}]-(user)'
						var props = buildSessionProps(rows.data)
						var session = driver.session()
						session.run(query, {props: props})
							.then(function(){
								this.setState({progress: Math.floor((sent / count) * 100)})
								session.close()
								parser.resume()
							}.bind(this))
					}else if (filetype === 'groupmembership'){
						var props = buildGroupMembershipProps(rows.data)
						var userQuery = 'UNWIND {props} AS prop MERGE (user:User {name:prop.account}) WITH user,prop MERGE (group:Group {name:prop.group}) WITH user,group MERGE (user)-[:MemberOf]->(group)'
						var computerQuery = 'UNWIND {props} AS prop MERGE (computer:Computer {name:prop.account}) WITH computer,prop MERGE (group:Group {name:prop.group}) WITH computer,group MERGE (computer)-[:MemberOf]->(group)'
						var groupQuery = 'UNWIND {props} AS prop MERGE (group1:Group {name:prop.account}) WITH group1,prop MERGE (group2:Group {name:prop.group}) WITH group1,group2 MERGE (group1)-[:MemberOf]->(group2)'
						var s1 = driver.session()
						var s2 = driver.session()
						var s3 = driver.session()
						var p1
						var p2
						var p3
						p1 = s1.run(userQuery, {props: props.users})
						p1.then(function(){
							s1.close()
							p2 = s2.run(computerQuery, {props: props.computers})
							p2.then(function(){
								s2.close()
								p3 = s3.run(groupQuery, {props: props.groups})
								p3.then(function(){
									s3.close()
									this.setState({progress: Math.floor((sent / count) * 100)})
									parser.resume()
								}.bind(this))
							}.bind(this))
						}.bind(this))
					}else if (filetype === 'localadmin'){
						var props = buildLocalAdminProps(rows.data)
						var userQuery = 'UNWIND {props} AS prop MERGE (user:User {name: prop.account}) WITH user,prop MERGE (computer:Computer {name: prop.computer}) WITH user,computer MERGE (user)-[:AdminTo]->(computer)'
						var groupQuery = 'UNWIND {props} AS prop MERGE (group:Group {name: prop.account}) WITH group,prop MERGE (computer:Computer {name: prop.computer}) WITH group,computer MERGE (group)-[:AdminTo]->(computer)'
						var computerQuery = 'UNWIND {props} AS prop MERGE (computer1:Computer {name: prop.account}) WITH computer1,prop MERGE (computer2:Computer {name: prop.computer}) WITH computer1,computer2 MERGE (computer1)-[:AdminTo]->(computer2)'

						var s1 = driver.session()
						var s2 = driver.session()
						var s3 = driver.session()
						var p1
						var p2
						var p3
						p1 = s1.run(userQuery, {props: props.users})
						p1.then(function(){
							s1.close()
							p2 = s2.run(computerQuery, {props: props.computers})
							p2.then(function(){
								s2.close()
								p3 = s3.run(groupQuery, {props: props.groups})
								p3.then(function(){
									s3.close()
									this.setState({progress: Math.floor((sent / count) * 100)})
									parser.resume()
								}.bind(this))
							}.bind(this))
						}.bind(this))
					}else{
						var props = buildDomainProps(rows.data)
						var query = "UNWIND {props} AS prop MERGE (domain1:Domain {name: prop.domain1}) WITH domain1,prop MERGE (domain2:Domain {name: prop.domain2}) WITH domain1,domain2,prop MERGE (domain1)-[:TrustedBy {TrustType : prop.trusttype, Transitive: prop.transitive}]->(domain2)"
						var session = driver.session()
						session.run(query, {props: props})
							.then(function(){
								this.setState({progress: Math.floor((sent / count) * 100)})
								session.close()
								parser.resume()
							}.bind(this))
					}
				}.bind(this)
			})
		}.bind(this))
	}

	_settingsClick(){
		emitter.emit('openSettings')
	}

	_cancelUploadClick(){
		emitter.emit('showCancelUpload')
	}

	render() {
		return (
			<div className="menudiv">
				<div>
					<MenuButton click={this._refreshClick.bind(this)} hoverVal="Refresh" glyphicon="glyphicon glyphicon-refresh" />
				</div>
				<div>
					<MenuButton click={this._exportClick.bind(this)} hoverVal="Export Graph" glyphicon="glyphicon glyphicon-export" />
				</div>
				<div>
					<MenuButton click={this._importClick.bind(this)} hoverVal="Import Graph" glyphicon="glyphicon glyphicon-import" />
				</div>
				<div>
					<If condition={this.state.uploading}>
						<Then>
							<ProgressBarMenuButton click={this._cancelUploadClick.bind(this)} progress={this.state.progress} committed={this.state.committed}/>
						</Then>
						<Else>{ () =>
							<MenuButton click={this._uploadClick.bind(this)} hoverVal="Upload Data" glyphicon="glyphicon glyphicon-upload" />		
						}</Else>
					</If>		
				</div>
				<div>
					<MenuButton click={this._changeLayoutClick.bind(this)} hoverVal="Change Layout Type" glyphicon="fa fa-line-chart" />
				</div>
				<div>
					<MenuButton click={this._settingsClick.bind(this)} hoverVal="Settings" glyphicon="fa fa-cogs" />
				</div>
			</div>
		);
	}
}
