import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { CorporateAuthService } from "./corporate-auth.service.js";

@Controller("auth/corporate")
export class CorporateAuthController {
  constructor(private readonly corporate:CorporateAuthService) {}
  @Get("initiate")
  async initiate(@Query("returnPath") returnPath:string|undefined,@Req() request:Request,@Res() response:Response):Promise<void>{
    const result=await this.corporate.initiate(returnPath,request);
    response.redirect(302,result.authorizationUrl);
  }
  @Get("callback")
  async callback(@Query("state") state:string|undefined,@Query("code") code:string|undefined,@Req() request:Request,@Res() response:Response):Promise<void>{
    const returnPath=await this.corporate.callback(state,code,request,response);
    response.redirect(302,returnPath);
  }
}
